#!/usr/bin/env bun

import { createHash } from "node:crypto";
import { chmod, mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import {
	formatJournalTimestamp,
	readRawLogTrace,
} from "../apps/admin/src/raw-logs.ts";

const JOURNAL_UNITS = Object.freeze([
	"hospital-platform-api-v2.service",
	"hospital-platform-worker-v2.service",
]);
const MAX_JOURNAL_BYTES = 64 * 1024 * 1024;
const MAX_METADATA_RECORDS = 100;
const IDENTIFIER_PATTERN = /^[A-Za-z0-9._:-]{1,256}$/u;

function usage() {
	console.error(`用法：
  bun tools/provider-trace-export.mjs --latest [--minutes 15]
  bun tools/provider-trace-export.mjs --id <traceId|requestId|providerRequestId> [--id <...>] [--since ISO] [--until ISO]

选项：
  --latest             只返回窗口内最新的安全元数据，不导出原始报文
  --id VALUE           按 traceId、requestId 或 Provider 请求号导出原始请求/返回，可重复
  --minutes N           未提供时间范围时使用的窗口分钟数，默认 15，最大 60
  --since ISO          日志窗口开始时间（ISO 8601）
  --until ISO          日志窗口结束时间（ISO 8601）
  --output-dir PATH    原始报文输出目录，默认 /tmp/provider-trace-<时间戳>
  --max-entries N      最多导出条目数，默认 300，最大 300
`);
}

function optionValue(args, flag) {
	const index = args.indexOf(flag);
	if (index < 0) return undefined;
	const value = args[index + 1];
	if (!value || value.startsWith("--")) {
		throw new Error(`${flag} 缺少值`);
	}
	return value;
}

function allOptionValues(args, flag) {
	const values = [];
	for (let index = 0; index < args.length; index += 1) {
		if (args[index] !== flag) continue;
		const value = args[index + 1];
		if (!value || value.startsWith("--")) throw new Error(`${flag} 缺少值`);
		values.push(value);
	}
	return values;
}

function parsePositiveInteger(value, fallback, maximum) {
	if (value === undefined) return fallback;
	if (!/^\d+$/u.test(value)) throw new Error(`数值不合法：${value}`);
	const parsed = Number(value);
	if (!Number.isSafeInteger(parsed) || parsed < 1 || parsed > maximum) {
		throw new Error(`数值必须在 1-${maximum} 之间`);
	}
	return parsed;
}

function parseDate(value, label) {
	if (!value) return undefined;
	const parsed = new Date(value);
	if (Number.isNaN(parsed.getTime()))
		throw new Error(`${label} 时间格式不合法`);
	return parsed;
}

function decodeMessage(value) {
	if (typeof value === "string") return value;
	if (!Array.isArray(value) || value.length > 1_000_000) return undefined;
	if (!value.every((item) => numberIsByte(item))) return undefined;
	try {
		return new TextDecoder("utf-8", { fatal: true }).decode(
			Uint8Array.from(value),
		);
	} catch {
		return undefined;
	}
}

function numberIsByte(value) {
	return Number.isInteger(value) && value >= 0 && value <= 255;
}

function parseApplicationRecord(line) {
	let envelope;
	try {
		const parsed = JSON.parse(line);
		if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
			return undefined;
		envelope = parsed;
	} catch {
		return undefined;
	}
	const messageText = decodeMessage(envelope.MESSAGE);
	if (!messageText) return undefined;
	try {
		const message = JSON.parse(messageText);
		if (!message || typeof message !== "object" || Array.isArray(message))
			return undefined;
		return { envelope, message };
	} catch {
		return undefined;
	}
}

function recordTimestamp(message, envelope) {
	if (
		typeof message.time === "string" &&
		!Number.isNaN(Date.parse(message.time))
	) {
		return new Date(message.time).toISOString();
	}
	if (
		typeof envelope.__REALTIME_TIMESTAMP === "string" &&
		/^\d+$/u.test(envelope.__REALTIME_TIMESTAMP)
	) {
		const millis = Number(
			envelope.__REALTIME_TIMESTAMP.slice(0, -3) ||
				envelope.__REALTIME_TIMESTAMP,
		);
		if (Number.isSafeInteger(millis)) return new Date(millis).toISOString();
	}
	return undefined;
}

function safeString(value) {
	return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function metadataFromRecord(parsed) {
	const { envelope, message } = parsed;
	const event = safeString(message.event);
	const timestamp = recordTimestamp(message, envelope);
	if (!event || !timestamp) return undefined;
	const values = {
		timestamp,
		unit: safeString(envelope._SYSTEMD_UNIT) || "unknown",
		event,
		operation:
			safeString(message.operation) || safeString(message.providerOperation),
		traceId: safeString(message.traceId),
		requestId: safeString(message.requestId),
		providerRequestId: safeString(message.providerRequestId),
		provider: safeString(message.provider),
		method: safeString(message.method),
		path: safeString(message.path),
		statusCode:
			typeof message.statusCode === "number" ? message.statusCode : undefined,
		providerStatusCode:
			typeof message.providerStatusCode === "number"
				? message.providerStatusCode
				: undefined,
		providerRequestOutcome: safeString(message.providerRequestOutcome),
		providerResponseBusinessSuccess:
			typeof message.providerResponseBusinessSuccess === "boolean"
				? message.providerResponseBusinessSuccess
				: undefined,
	};
	return Object.fromEntries(
		Object.entries(values).filter(([, value]) => value !== undefined),
	);
}

async function journal(args) {
	const child = Bun.spawn(["journalctl", ...args], {
		stdout: "pipe",
		stderr: "pipe",
	});
	const output = await new Response(child.stdout).text();
	const exitCode = await child.exited;
	if (exitCode !== 0) throw new Error("journalctl 执行失败");
	if (new TextEncoder().encode(output).byteLength > MAX_JOURNAL_BYTES) {
		throw new Error("日志窗口超过 64 MiB，请缩短时间范围");
	}
	return output;
}

function journalArgs(since, until) {
	return [
		"--all",
		"-o",
		"json",
		"--no-pager",
		...JOURNAL_UNITS.flatMap((unit) => ["-u", unit]),
		"--since",
		formatJournalTimestamp(since),
		"--until",
		formatJournalTimestamp(until),
	];
}

function boundedWindow(sinceValue, untilValue, minutes) {
	const until = untilValue || new Date();
	const since = sinceValue || new Date(until.getTime() - minutes * 60_000);
	if (until.getTime() < since.getTime())
		throw new Error("since 不能晚于 until");
	return { since, until };
}

async function latestMetadata(window) {
	const serialized = await journal(journalArgs(window.since, window.until));
	const records = [];
	const seen = new Set();
	for (const line of serialized.split(/\r?\n/u)) {
		if (!line) continue;
		const parsed = parseApplicationRecord(line);
		if (!parsed) continue;
		const metadata = metadataFromRecord(parsed);
		if (!metadata) continue;
		const correlation =
			metadata.traceId ||
			metadata.requestId ||
			metadata.providerRequestId ||
			"";
		const key = `${metadata.timestamp}\u0001${metadata.unit}\u0001${metadata.event}\u0001${correlation}`;
		if (seen.has(key)) continue;
		seen.add(key);
		records.push(metadata);
	}
	records.sort((left, right) => right.timestamp.localeCompare(left.timestamp));
	return records.slice(0, MAX_METADATA_RECORDS);
}

function safePathPart(value, fallback) {
	const normalized = String(value || fallback)
		.replace(/[^A-Za-z0-9_.-]+/gu, "-")
		.replace(/^-+|-+$/gu, "")
		.slice(0, 96);
	return normalized || fallback;
}

function fullSha256(value) {
	return createHash("sha256").update(value, "utf8").digest("hex");
}

async function writeControlledTrace(trace, outputDir) {
	await mkdir(outputDir, { recursive: true, mode: 0o700 });
	await chmod(outputDir, 0o700);
	const entries = [];
	for (const [index, entry] of trace.entries.entries()) {
		const base = `${String(index + 1).padStart(3, "0")}-${safePathPart(entry.operation || entry.event, "provider")}-${entry.direction}`;
		const bodyFile =
			entry.complete && entry.bodyText !== undefined
				? `${base}.${entry.bodyText.trimStart().startsWith("{") || entry.bodyText.trimStart().startsWith("[") ? "json" : "txt"}`
				: undefined;
		if (bodyFile) {
			const bodyPath = resolve(outputDir, bodyFile);
			await writeFile(bodyPath, entry.bodyText, {
				encoding: "utf8",
				mode: 0o600,
			});
			await chmod(bodyPath, 0o600);
		}
		const { bodyText: _bodyText, ...metadata } = entry;
		entries.push({
			...metadata,
			...(bodyFile ? { bodyFile } : {}),
			...(entry.bodyText !== undefined
				? { bodySha256: fullSha256(entry.bodyText) }
				: {}),
		});
	}
	const manifest = {
		schemaVersion: 1,
		generatedAt: new Date().toISOString(),
		query: {
			identifiers: trace.identifiers,
			since: trace.since,
			until: trace.until,
			maxEntries: trace.maxEntries,
		},
		matchedJournalRecords: trace.matchedJournalRecords,
		entryCount: trace.entries.length,
		completeEntryCount: trace.entries.filter((entry) => entry.complete).length,
		entries,
	};
	const manifestPath = resolve(outputDir, "manifest.json");
	await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, {
		encoding: "utf8",
		mode: 0o600,
	});
	await chmod(manifestPath, 0o600);
	return { manifestPath, entries };
}

function parseArguments(args) {
	if (args.includes("--help") || args.includes("-h")) {
		usage();
		process.exit(0);
	}
	const identifiers = allOptionValues(args, "--id");
	for (const identifier of identifiers) {
		if (!IDENTIFIER_PATTERN.test(identifier))
			throw new Error("关联号格式不合法");
	}
	const minutes = parsePositiveInteger(optionValue(args, "--minutes"), 15, 60);
	const maxEntries = parsePositiveInteger(
		optionValue(args, "--max-entries"),
		300,
		300,
	);
	const since = parseDate(optionValue(args, "--since"), "since");
	const until = parseDate(optionValue(args, "--until"), "until");
	const latest = args.includes("--latest");
	if (!latest && identifiers.length === 0)
		throw new Error("请指定 --latest 或至少一个 --id");
	if (latest && identifiers.length > 0)
		throw new Error("--latest 不能和 --id 同时使用");
	const outputDir = optionValue(args, "--output-dir");
	return { identifiers, minutes, maxEntries, since, until, latest, outputDir };
}

export async function main(args = process.argv.slice(2)) {
	const options = parseArguments(args);
	const window = boundedWindow(options.since, options.until, options.minutes);
	if (options.latest) {
		const records = await latestMetadata(window);
		console.log(
			JSON.stringify(
				{
					mode: "metadata",
					window: {
						since: window.since.toISOString(),
						until: window.until.toISOString(),
					},
					count: records.length,
					records,
				},
				null,
				2,
			),
		);
		return;
	}
	const trace = await readRawLogTrace({
		identifiers: options.identifiers,
		since: window.since.toISOString(),
		until: window.until.toISOString(),
		maxEntries: options.maxEntries,
	});
	const outputDir = resolve(
		options.outputDir || `/tmp/provider-trace-${Date.now()}`,
	);
	const written = await writeControlledTrace(trace, outputDir);
	console.log(
		JSON.stringify(
			{
				mode: "raw-trace",
				outputDir,
				manifestPath: written.manifestPath,
				entryCount: trace.entries.length,
				completeEntryCount: trace.entries.filter((entry) => entry.complete)
					.length,
				matchedJournalRecords: trace.matchedJournalRecords,
				window: { since: trace.since, until: trace.until },
			},
			null,
			2,
		),
	);
}

if (import.meta.main) {
	try {
		await main();
	} catch (error) {
		console.error(
			error instanceof Error ? error.message : "provider-trace-export failed",
		);
		usage();
		process.exitCode = 1;
	}
}
