#!/usr/bin/env bun

/**
 * 3090 日支付日志一键导出器。
 *
 * 默认通过 SSH 跳板执行：
 *   journalctl --all -u hospital-platform-api-v2.service
 *     -u hospital-platform-worker-v2.service -o json --no-pager
 *
 * 采集到的 journald、逐接口 request/response、FSI 补充原文和归档全部写入
 * 受控目录（目录 700、文件 600）。标准输出只包含 daily-index.md 路径，
 * 不回显患者凭证、请求头、授权码或原始 Provider 报文。导出目录内的
 * request/response JSON 是明文受控文件，权限固定为 600。
 */

import { createHash } from "node:crypto";
import { chmod, mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { platform, tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { readRawLogTraceFromSerialized } from "../apps/admin/src/raw-logs.ts";

const JOURNAL_UNITS = Object.freeze([
	"hospital-platform-api-v2.service",
	"hospital-platform-worker-v2.service",
]);
const MAX_JOURNAL_BYTES = 64 * 1024 * 1024;
const MAX_OUTPUT_ENTRIES = 300;
const LATEST_LOOKBACK_MS = 2 * 60 * 1000;
const PAYMENT_EVENT =
	/^(?:medical-insurance\.|payment\.wechat_prepay\.|outpatient\.self-payment\.|appointment\.self-payment\.|worker\.payment\.)/u;
const ORDER_PAYMENT_EVENT =
	/^(?:medical-insurance\.(?:authorization\.(?:requested|completed)|fees\.|settlement\.|wechat-mix\.|pre-payment-component\.|(?:\d|plugin\.)|cancellation\.|reauthorization\.)|payment\.wechat_prepay\.|outpatient\.self-payment\.|appointment\.self-payment\.|worker\.payment\.(?:medical|wechat))/u;
const ORDER_SEED_EVENTS = new Set([
	"medical-insurance.authorization.requested",
	"medical-insurance.wechat-mix.requested",
	"payment.wechat_prepay.requested",
	"payment.wechat_prepay.created",
	"payment.wechat_prepay.failed",
	"outpatient.self-payment.requested",
	"outpatient.self-payment.provider-settlement-succeeded",
	"appointment.self-payment.2.27.2.29.persisted",
	"medical-insurance.plugin.2.27.2.29.persisted",
]);

function usage() {
	console.error(`用法：
  bun tools/payment-day-export.mjs [--date YYYY-MM-DD]
  bun tools/payment-day-export.mjs --input-file <journal.jsonl> [--date YYYY-MM-DD]
  bun tools/payment-day-export.mjs --latest [--date YYYY-MM-DD]

选项：
  --date YYYY-MM-DD       中国标准时间日历日，默认今天
  --since VALUE           覆盖远端 journalctl 开始时间
  --until VALUE           覆盖远端 journalctl 结束时间
  --latest                只导出窗口内开始时间最新的一笔支付订单
  --input-file PATH       使用已有 journald JSONL，不连接 SSH
  --output-dir PATH       指定受控输出目录；默认临时目录下按时间命名
  --no-archive            不生成 tar.gz（默认生成）
  --ssh-target VALUE      默认 ps@10.0.0.3
  --ssh-jump VALUE        默认 meiyi.pro；传空字符串可关闭跳板
  --ssh-key PATH          默认 ~/.ssh/aliyun-3090；不存在时交给 ssh agent
  --remote-sudo           在远端以 sudo -n 执行 journalctl
  --help                  显示帮助

环境变量（命令行优先）：
  PAYMENT_LOG_SSH_TARGET / PAYMENT_LOG_SSH_JUMP / PAYMENT_LOG_SSH_KEY
  PAYMENT_LOG_OUTPUT_ROOT / PAYMENT_LOG_REMOTE_SUDO=true
`);
}

function optionValue(args, flag) {
	const index = args.indexOf(flag);
	if (index < 0) return undefined;
	const value = args[index + 1];
	if (!value || value.startsWith("--")) throw new Error(`${flag} 缺少值`);
	return value;
}

function parseArgs(args) {
	if (args.includes("--help") || args.includes("-h")) {
		usage();
		process.exit(0);
	}
	const date = optionValue(args, "--date") || shanghaiDate(new Date());
	if (!/^\d{4}-\d{2}-\d{2}$/u.test(date))
		throw new Error("--date 必须是 YYYY-MM-DD");
	const since = optionValue(args, "--since") || `${date} 00:00:00`;
	const until = optionValue(args, "--until") || `${date} 23:59:59`;
	const inputFile = optionValue(args, "--input-file");
	const outputDir = optionValue(args, "--output-dir");
	const sshTarget =
		optionValue(args, "--ssh-target") ||
		process.env.PAYMENT_LOG_SSH_TARGET ||
		"ps@10.0.0.3";
	const sshJump = args.includes("--ssh-jump")
		? optionValue(args, "--ssh-jump")
		: (process.env.PAYMENT_LOG_SSH_JUMP ?? "meiyi.pro");
	const sshKey =
		optionValue(args, "--ssh-key") ||
		process.env.PAYMENT_LOG_SSH_KEY ||
		(process.env.HOME ? join(process.env.HOME, ".ssh/aliyun-3090") : undefined);
	const remoteSudo =
		args.includes("--remote-sudo") ||
		process.env.PAYMENT_LOG_REMOTE_SUDO === "true";
	return {
		date,
		since,
		until,
		inputFile,
		outputDir,
		latest: args.includes("--latest"),
		noArchive: args.includes("--no-archive"),
		sshTarget,
		sshJump,
		sshKey,
		remoteSudo,
	};
}

function shanghaiDate(value) {
	return new Intl.DateTimeFormat("en-CA", {
		timeZone: "Asia/Shanghai",
		year: "numeric",
		month: "2-digit",
		day: "2-digit",
	}).format(value);
}

function shanghaiIso(value) {
	const date = new Date(value);
	if (Number.isNaN(date.getTime())) return value;
	const parts = Object.fromEntries(
		new Intl.DateTimeFormat("en-CA", {
			timeZone: "Asia/Shanghai",
			year: "numeric",
			month: "2-digit",
			day: "2-digit",
			hour: "2-digit",
			minute: "2-digit",
			second: "2-digit",
			hourCycle: "h23",
		})
			.formatToParts(date)
			.map(({ type, value: part }) => [type, part]),
	);
	return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}:${parts.second}.${String(date.getMilliseconds()).padStart(3, "0")}+08:00`;
}

function shanghaiJournalTime(value) {
	return shanghaiIso(value).slice(0, 19).replace("T", " ");
}

function shanghaiWindow(date, since, until) {
	const start = new Date(`${date}T00:00:00+08:00`);
	const end = new Date(`${date}T23:59:59+08:00`);
	if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()))
		throw new Error("日期窗口无效");
	const sinceDate = since === `${date} 00:00:00` ? start : new Date(since);
	const untilDate = until === `${date} 23:59:59` ? end : new Date(until);
	if (Number.isNaN(sinceDate.getTime()) || Number.isNaN(untilDate.getTime()))
		throw new Error("--since/--until 时间格式无效");
	if (untilDate.getTime() < sinceDate.getTime())
		throw new Error("--since 不能晚于 --until");
	return {
		start,
		end,
		sinceText: since,
		untilText: until,
		sinceIso: sinceDate.toISOString(),
		untilIso: untilDate.toISOString(),
	};
}

function latestCaptureWindow(window) {
	const requestedSince = Date.parse(window.sinceIso);
	const dayStart = window.start.getTime();
	const captureSince = Math.max(dayStart, requestedSince - LATEST_LOOKBACK_MS);
	return {
		...window,
		sinceText: shanghaiJournalTime(captureSince),
		sinceIso: new Date(captureSince).toISOString(),
	};
}

function shellQuote(value) {
	return `'${String(value).replaceAll("'", "'\\''")}'`;
}

async function runProcess(
	command,
	args,
	{ maxBytes = MAX_JOURNAL_BYTES } = {},
) {
	const child = Bun.spawn([command, ...args], {
		stdout: "pipe",
		stderr: "pipe",
	});
	const [stdout, stderr, exitCode] = await Promise.all([
		new Response(child.stdout).text(),
		new Response(child.stderr).text(),
		child.exited,
	]);
	if (new TextEncoder().encode(stdout).byteLength > maxBytes)
		throw new Error("日志窗口超过 64 MiB，请缩短时间范围");
	if (exitCode !== 0) {
		const suffix = stderr.trim().slice(-240);
		throw new Error(`${command} 执行失败${suffix ? `：${suffix}` : ""}`);
	}
	return stdout;
}

async function remoteJournal(options, window) {
	const journalArgs = [
		...(options.remoteSudo ? ["sudo", "-n"] : []),
		"journalctl",
		"--all",
		"-o",
		"json",
		"--no-pager",
		...JOURNAL_UNITS.flatMap((unit) => ["-u", unit]),
		"--since",
		window.sinceText,
		"--until",
		window.untilText,
	];
	const sshArgs = ["-o", "BatchMode=yes"];
	if (options.sshJump) sshArgs.push("-J", options.sshJump);
	if (options.sshKey) {
		try {
			await stat(options.sshKey);
			sshArgs.push("-i", options.sshKey);
		} catch {
			// 没有默认密钥时允许 ssh agent 或 ~/.ssh/config 接管认证。
		}
	}
	const remoteCommand = journalArgs.map(shellQuote).join(" ");
	return runProcess("ssh", [...sshArgs, options.sshTarget, remoteCommand]);
}

function sha256Bytes(value) {
	return createHash("sha256").update(value).digest("hex");
}

function sha256Text(value) {
	return sha256Bytes(Buffer.from(value, "utf8"));
}

function safePart(value, fallback = "item") {
	const candidate = String(value || fallback)
		.replace(/[^A-Za-z0-9_.:-]+/gu, "-")
		.replace(/^-+|-+$/gu, "")
		.slice(0, 128);
	return candidate || fallback;
}

function decodeMessage(value) {
	if (typeof value === "string") return value;
	if (!Array.isArray(value) || value.length > 1_000_000) return undefined;
	if (
		!value.every((item) => Number.isInteger(item) && item >= 0 && item <= 255)
	)
		return undefined;
	try {
		return new TextDecoder("utf-8", { fatal: true }).decode(
			Uint8Array.from(value),
		);
	} catch {
		return undefined;
	}
}

function recordTime(message, envelope) {
	if (
		typeof message.time === "string" &&
		!Number.isNaN(Date.parse(message.time))
	)
		return new Date(message.time).toISOString();
	const raw = envelope.__REALTIME_TIMESTAMP;
	if (typeof raw !== "string" || !/^\d+$/u.test(raw)) return undefined;
	const millis = Number(raw.slice(0, -3) || raw);
	return Number.isSafeInteger(millis)
		? new Date(millis).toISOString()
		: undefined;
}

function parseRecords(serialized) {
	const records = [];
	const lines = serialized.split(/\r?\n/u);
	let malformedEnvelopeCount = 0;
	let malformedMessageCount = 0;
	for (const line of lines) {
		if (!line) continue;
		let envelope;
		try {
			const parsed = JSON.parse(line);
			if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
				throw new Error("envelope-not-object");
			envelope = parsed;
		} catch {
			malformedEnvelopeCount += 1;
			continue;
		}
		const messageText = decodeMessage(envelope.MESSAGE);
		if (!messageText) {
			malformedMessageCount += 1;
			continue;
		}
		let message;
		try {
			const parsed = JSON.parse(messageText);
			if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
				throw new Error("message-not-object");
			message = parsed;
		} catch {
			malformedMessageCount += 1;
			continue;
		}
		const time = recordTime(message, envelope);
		if (!time || typeof message.event !== "string") continue;
		records.push({
			line,
			envelope,
			message,
			time,
			unit: envelope._SYSTEMD_UNIT || "unknown",
		});
	}
	return { records, malformedEnvelopeCount, malformedMessageCount };
}

function stringValue(value) {
	return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function addIdentifier(set, value) {
	const text = stringValue(value);
	if (text && text.length <= 512) set.add(text);
}

function orderSeed(record) {
	const m = record.message;
	const orderId = stringValue(m.orderId);
	// 后台查单重试属于已有支付订单的生命周期事件，不能单独生成一笔
	// “最新支付”，否则会把完整支付误选成只有查单响应的孤立订单。
	const isBackgroundRetry = m.event.startsWith("worker.payment.");
	return orderId &&
		!isBackgroundRetry &&
		(ORDER_SEED_EVENTS.has(m.event) || ORDER_PAYMENT_EVENT.test(m.event))
		? orderId
		: undefined;
}

function createOrder(seedRecord, orderId) {
	return {
		orderId,
		appointmentId: stringValue(seedRecord.message.appointmentId),
		started: seedRecord.time,
		records: [],
		identifiers: new Set([orderId]),
	};
}

function collectOrders(records) {
	const orders = new Map();
	for (const record of records) {
		const seed = orderSeed(record);
		if (!seed) continue;
		if (!orders.has(seed)) orders.set(seed, createOrder(record, seed));
	}
	const ordered = [...orders.values()].sort((left, right) =>
		left.started.localeCompare(right.started),
	);
	const addRecord = (order, record) => {
		order.records.push(record);
		const m = record.message;
		if (!order.appointmentId)
			order.appointmentId = stringValue(m.appointmentId);
		addIdentifier(order.identifiers, m.traceId);
		addIdentifier(order.identifiers, m.requestId);
		addIdentifier(order.identifiers, m.providerRequestId);
		addIdentifier(order.identifiers, m.taskId);
		if (Array.isArray(m.providerRequestIds)) {
			for (const value of m.providerRequestIds)
				addIdentifier(order.identifiers, value);
		}
	};
	// 先放入带 orderId/taskId 的记录，后续才能用取消完成时间切分同一
	// appointment 的重新授权生命周期。
	for (const record of records) {
		const m = record.message;
		const explicit = ordered.find(
			(order) => m.orderId === order.orderId || m.taskId === order.orderId,
		);
		if (explicit) addRecord(explicit, record);
	}
	for (const record of records) {
		const m = record.message;
		if (
			ordered.some(
				(order) => m.orderId === order.orderId || m.taskId === order.orderId,
			)
		)
			continue;
		const candidates = ordered.filter(
			(order) =>
				order.appointmentId &&
				(m.appointmentId === order.appointmentId ||
					m.businessId === order.appointmentId),
		);
		if (candidates.length === 0) continue;
		const recordMillis = Date.parse(record.time);
		if (candidates.length === 1) {
			addRecord(candidates[0], record);
			continue;
		}
		const timeline = [...candidates].sort((left, right) =>
			left.started.localeCompare(right.started),
		);
		let selected = timeline[0];
		for (let index = 0; index < timeline.length; index += 1) {
			const current = timeline[index];
			const start = Date.parse(current.started);
			const nextStart = timeline[index + 1]
				? Date.parse(timeline[index + 1].started)
				: Number.POSITIVE_INFINITY;
			if (recordMillis >= start && recordMillis < nextStart) {
				selected = current;
				break;
			}
		}
		// 如果上一笔在下一次授权开始前已经完成取消，取消完成后的
		// profile/archive 等前置调用属于下一笔，而不是已取消订单。
		for (let index = 1; index < timeline.length; index += 1) {
			const previous = timeline[index - 1];
			const cancellationTimes = previous.records
				.filter((item) =>
					/\.cancellation(?:\.2\.6\.65\.6)?\.completed$/u.test(
						item.message.event,
					),
				)
				.map((item) => Date.parse(item.time));
			const cancellationTime = Math.max(...cancellationTimes);
			if (
				recordMillis >= cancellationTime &&
				recordMillis < Date.parse(timeline[index].started)
			) {
				selected = timeline[index];
			}
		}
		addRecord(selected, record);
	}
	for (const order of ordered) {
		order.records.sort((left, right) => left.time.localeCompare(right.time));
	}
	return ordered;
}

function rawLayer(event) {
	if (event === "provider.request.raw" || event === "provider.response.raw")
		return "transport";
	if (
		event === "provider.request.logical.raw" ||
		event === "provider.response.logical.raw"
	)
		return "logical";
	if (event === "medical-insurance.legacy-fsi.response.raw") return "legacy";
	return "other";
}

function rawInvocationKey(entry, layer) {
	const correlation =
		entry.traceId ||
		entry.providerRequestId ||
		entry.requestId ||
		entry.timestamp;
	return [
		layer,
		correlation,
		entry.operation || entry.event,
		entry.provider || "",
	].join("\u0001");
}

function pairRawEntries(entries) {
	const groups = new Map();
	for (const entry of entries) {
		const layer = rawLayer(entry.event);
		const key = rawInvocationKey(entry, layer);
		const group = groups.get(key) || {
			layer,
			operation: entry.operation || entry.event,
			provider: entry.provider,
			traceId: entry.traceId,
			providerRequestId: entry.providerRequestId,
			request: [],
			response: [],
		};
		if (entry.direction === "request") group.request.push(entry);
		else group.response.push(entry);
		groups.set(key, group);
	}
	const invocations = [];
	for (const group of groups.values()) {
		group.request.sort((left, right) =>
			left.timestamp.localeCompare(right.timestamp),
		);
		group.response.sort((left, right) =>
			left.timestamp.localeCompare(right.timestamp),
		);
		const count = Math.max(group.request.length, group.response.length, 1);
		for (let index = 0; index < count; index += 1) {
			const request = group.request[index];
			const response = group.response[index];
			invocations.push({
				layer: group.layer,
				operation: group.operation,
				provider: group.provider,
				traceId: request?.traceId || response?.traceId || group.traceId,
				providerRequestId:
					request?.providerRequestId ||
					response?.providerRequestId ||
					group.providerRequestId,
				invocationIndex: index,
				request,
				response,
			});
		}
	}
	return invocations.sort((left, right) => {
		const leftTime = left.request?.timestamp || left.response?.timestamp || "";
		const rightTime =
			right.request?.timestamp || right.response?.timestamp || "";
		return leftTime.localeCompare(rightTime);
	});
}

function assignRawEntriesToOrder(entries, order, allOrders) {
	const orderTimes = new Map(
		allOrders.map((candidate) => [
			candidate.orderId,
			candidate.records.map((record) => Date.parse(record.time)),
		]),
	);
	return entries.filter((entry) => {
		const entryTime = Date.parse(entry.timestamp);
		const entryIdentifiers = new Set(
			[entry.traceId, entry.requestId, entry.providerRequestId].filter(Boolean),
		);
		const correlated = allOrders.filter((candidate) =>
			[...entryIdentifiers].some((identifier) =>
				candidate.identifiers.has(identifier),
			),
		);
		if (correlated.length > 1) {
			const timeline = [...correlated].sort((left, right) =>
				left.started.localeCompare(right.started),
			);
			let selected = timeline[0];
			for (let index = 0; index < timeline.length; index += 1) {
				const current = timeline[index];
				const nextStart = timeline[index + 1]
					? Date.parse(timeline[index + 1].started)
					: Number.POSITIVE_INFINITY;
				if (entryTime >= Date.parse(current.started) && entryTime < nextStart) {
					selected = current;
					break;
				}
			}
			for (let index = 1; index < timeline.length; index += 1) {
				const previous = timeline[index - 1];
				const cancellationTimes = previous.records
					.filter((item) =>
						/\.cancellation(?:\.2\.6\.65\.6)?\.completed$/u.test(
							item.message.event,
						),
					)
					.map((item) => Date.parse(item.time));
				const cancellationTime = Math.max(...cancellationTimes);
				if (
					Number.isFinite(cancellationTime) &&
					entryTime >= cancellationTime &&
					entryTime < Date.parse(timeline[index].started)
				) {
					selected = timeline[index];
				}
			}
			return selected.orderId === order.orderId;
		}
		if (correlated.length === 1) return correlated[0].orderId === order.orderId;
		let nearestOrder;
		let nearestDistance = Number.POSITIVE_INFINITY;
		for (const candidate of allOrders) {
			const times = orderTimes.get(candidate.orderId) || [];
			for (const time of times) {
				const distance = Math.abs(entryTime - time);
				if (distance < nearestDistance) {
					nearestDistance = distance;
					nearestOrder = candidate.orderId;
				}
			}
		}
		return nearestOrder === order.orderId;
	});
}

function parseBody(bodyText) {
	if (typeof bodyText !== "string") return undefined;
	try {
		return expandNestedJson(JSON.parse(bodyText));
	} catch {
		return bodyText;
	}
}

/**
 * Provider 返回里有些字段本身还是 JSON 字符串（例如
 * `passthrough_response_content`）。导出给人工核对时递归展开对象/数组，
 * 避免在 response.json 里出现一整行反斜杠转义内容。
 * 只有以 `{` 或 `[` 开始且确实能解析成对象/数组的字符串才会展开，普通
 * 文本、签名、URL、编码报文和加密字符串保持原值。
 */
function expandNestedJson(value, depth = 0) {
	if (depth >= 8) return value;
	if (Array.isArray(value))
		return value.map((item) => expandNestedJson(item, depth + 1));
	if (value && typeof value === "object") {
		return Object.fromEntries(
			Object.entries(value).map(([key, item]) => [
				key,
				expandNestedJson(item, depth + 1),
			]),
		);
	}
	if (typeof value !== "string") return value;
	const trimmed = value.trimStart();
	if (!trimmed.startsWith("{") && !trimmed.startsWith("[")) return value;
	try {
		const parsed = JSON.parse(trimmed);
		if (!parsed || typeof parsed !== "object") return value;
		return expandNestedJson(parsed, depth + 1);
	} catch {
		return value;
	}
}

function parseHeaders(headersText) {
	if (!headersText) return undefined;
	try {
		return JSON.parse(headersText);
	} catch {
		return headersText;
	}
}

function requestPacket(entry) {
	if (!entry) return undefined;
	if (entry.url || entry.method || entry.headersText) {
		return {
			...(entry.method ? { method: entry.method } : {}),
			...(entry.url ? { url: entry.url } : {}),
			...(entry.headersText
				? { headers: parseHeaders(entry.headersText) }
				: {}),
			body: parseBody(entry.bodyText || ""),
		};
	}
	return parseBody(entry.bodyText || "");
}

function responsePacket(entry) {
	return entry ? parseBody(entry.bodyText || "") : undefined;
}

const READABLE_OPERATION_NAMES = new Map([
	["outpatient-payment-context", "支付上下文"],
	["appointment-patient-profile", "就诊人信息"],
	["appointment-patient-archive", "就诊人档案"],
	["appointment-active-records", "预约记录"],
	["appointment-registration-create", "挂号创建"],
	["appointment-cancellation", "预约取消"],
	["medical-insurance.authorization.user-query", "医保授权查询"],
	["medical-mix-create", "混合支付下单"],
	["medical-mix-query", "混合支付查单"],
	["medical-mix-query-by-out-trade-no", "混合支付按外部订单查单"],
]);

function operationCode(operation) {
	if (typeof operation !== "string") return undefined;
	return operation.match(/(?:^|\.)(2(?:\.\d+){2,4}|\d{4})(?:\.|$)/u)?.[1];
}

function displayOperation(operation, { plaintext = false } = {}) {
	const code = operationCode(operation);
	if (code) return plaintext ? `${code}（业务明文）` : code;
	return READABLE_OPERATION_NAMES.get(operation) || "支付接口";
}

function isFsiPlaintextOperation(operation) {
	return operation === "legacy-fsi.6201" || operation === "legacy-fsi.6202";
}

function findPlaintextFsiInvocation(primary, invocations) {
	if (!isFsiPlaintextOperation(primary.operation)) return undefined;
	const candidates = invocations.filter(
		(candidate) =>
			(candidate.layer === "logical" || candidate.layer === "legacy") &&
			candidate.operation === primary.operation &&
			candidate.invocationIndex === primary.invocationIndex &&
			((primary.traceId && candidate.traceId === primary.traceId) ||
				(primary.providerRequestId &&
					candidate.providerRequestId === primary.providerRequestId)),
	);
	const logical = candidates.find((candidate) => candidate.layer === "logical");
	const legacy = candidates.find((candidate) => candidate.layer === "legacy");
	const request = [logical?.request, legacy?.request].find(
		(entry) => entry?.complete,
	);
	const response = [logical?.response, legacy?.response].find(
		(entry) => entry?.complete,
	);
	if (!request && !response) return undefined;
	return {
		...primary,
		layer: "logical",
		request,
		response,
	};
}

function isPrimaryInvocation(invocation) {
	return invocation.layer === "transport";
}

function operationLabel(invocation, ordinal) {
	const base = safePart(invocation.operation || "provider");
	const suffix =
		invocation.invocationIndex > 0
			? `-attempt-${invocation.invocationIndex + 1}`
			: "";
	return `${String(ordinal).padStart(3, "0")}-${base}${suffix}`;
}

function eventSummary(records) {
	const counts = new Map();
	for (const record of records) {
		counts.set(
			record.message.event,
			(counts.get(record.message.event) || 0) + 1,
		);
	}
	return Object.fromEntries(
		[...counts.entries()].sort(([a], [b]) => a.localeCompare(b)),
	);
}

function orderStatus(records, invocations) {
	const events = new Set(records.map((record) => record.message.event));
	if (
		events.has("medical-insurance.reauthorization.cancellation.completed") ||
		events.has("medical-insurance.cancellation.completed")
	)
		return "CANCELLED";
	if (
		events.has("worker.payment.medical_order_query.manual_review_required") ||
		events.has("worker.payment.medical_wechat_query.manual_review_required")
	)
		return "MANUAL_REVIEW_REQUIRED";
	if (
		events.has("medical-insurance.2.27.2.32.completed") ||
		events.has("medical-insurance.2.6.65.5.completed")
	)
		return "PROVIDER_COMPLETED";
	if (
		invocations.some((invocation) => invocation.request && invocation.response)
	)
		return "OBSERVED";
	return "INCOMPLETE";
}

async function writeJson(path, value) {
	const content = `${JSON.stringify(value, null, 2)}\n`;
	await writeFile(path, content, { encoding: "utf8", mode: 0o600 });
	await chmod(path, 0o600);
	return {
		path,
		bytes: Buffer.byteLength(content),
		sha256: sha256Text(content),
	};
}

async function writeRawBody(path, bodyText) {
	if (bodyText === undefined) return undefined;
	await writeFile(path, bodyText, { encoding: "utf8", mode: 0o600 });
	await chmod(path, 0o600);
	return {
		path,
		bytes: Buffer.byteLength(bodyText),
		sha256: sha256Text(bodyText),
	};
}

function entryChecks(entry) {
	return entry
		? {
				event: entry.event,
				encoding: entry.bodyEncoding,
				chunkCount: entry.chunkCount,
				complete: entry.complete,
				...(entry.missingChunkIndexes
					? { missingChunkIndexes: entry.missingChunkIndexes }
					: {}),
				...(entry.integrity ? { integrity: entry.integrity } : {}),
				...(entry.error ? { error: entry.error } : {}),
			}
		: { present: false };
}

async function writeOrder(order, serialized, window, rootDir, allOrders) {
	const orderDir = join(rootDir, "orders", safePart(order.orderId));
	const interfacesDir = join(orderDir, "interfaces");
	const evidenceDir = join(orderDir, "raw-evidence");
	await mkdir(interfacesDir, { recursive: true, mode: 0o700 });
	await mkdir(evidenceDir, { recursive: true, mode: 0o700 });
	await chmod(orderDir, 0o700);
	await chmod(interfacesDir, 0o700);
	await chmod(evidenceDir, 0o700);

	const trace = readRawLogTraceFromSerialized(
		{
			identifiers: [...order.identifiers],
			since: window.sinceIso,
			until: window.untilIso,
			maxEntries: MAX_OUTPUT_ENTRIES,
		},
		serialized,
	);
	const ownEntries = assignRawEntriesToOrder(trace.entries, order, allOrders);
	const invocations = pairRawEntries(ownEntries);
	const primary = invocations.filter(isPrimaryInvocation);
	const records = order.records;
	const interfaceRows = [];
	let ordinal = 0;
	for (const invocation of primary) {
		ordinal += 1;
		const base = operationLabel(invocation, ordinal);
		const dir = join(interfacesDir, base);
		await mkdir(dir, { recursive: true, mode: 0o700 });
		await chmod(dir, 0o700);
		const plaintextInvocation = findPlaintextFsiInvocation(
			invocation,
			invocations,
		);
		const displayInvocation = plaintextInvocation || invocation;
		const request = requestPacket(displayInvocation.request);
		const response = responsePacket(displayInvocation.response);
		const requestPath = join(dir, "request.json");
		const responsePath = join(dir, "response.json");
		const requestFile = await writeJson(requestPath, request ?? null);
		const responseFile = await writeJson(responsePath, response ?? null);
		const requestRaw = await writeRawBody(
			join(dir, "request-body.raw"),
			invocation.request?.bodyText,
		);
		const responseRaw = await writeRawBody(
			join(dir, "response-body.raw"),
			invocation.response?.bodyText,
		);
		interfaceRows.push({
			ordinal,
			operation: invocation.operation,
			displayOperation: displayOperation(invocation.operation, {
				plaintext: Boolean(plaintextInvocation),
			}),
			displayLayer: plaintextInvocation ? "business-plaintext" : "transport",
			invocationIndex: invocation.invocationIndex,
			traceId: invocation.traceId,
			providerRequestId: invocation.providerRequestId,
			requestChecks: entryChecks(displayInvocation.request),
			responseChecks: entryChecks(displayInvocation.response),
			transportRequestChecks: entryChecks(invocation.request),
			transportResponseChecks: entryChecks(invocation.response),
			requestPath,
			responsePath,
			requestFileBytes: requestFile.bytes,
			responseFileBytes: responseFile.bytes,
			requestFileSha256: requestFile.sha256,
			responseFileSha256: responseFile.sha256,
			...(requestRaw ? { requestBodyRaw: requestRaw } : {}),
			...(responseRaw ? { responseBodyRaw: responseRaw } : {}),
		});
	}

	const supplemental = [];
	let evidenceOrdinal = 0;
	for (const invocation of invocations.filter(
		(item) => !isPrimaryInvocation(item),
	)) {
		evidenceOrdinal += 1;
		const base = `${String(evidenceOrdinal).padStart(3, "0")}-${safePart(invocation.operation || "provider")}-${invocation.layer}-attempt-${invocation.invocationIndex + 1}`;
		const requestRaw = await writeRawBody(
			join(evidenceDir, `${base}-request.raw`),
			invocation.request?.bodyText,
		);
		const responseRaw = await writeRawBody(
			join(evidenceDir, `${base}-response.raw`),
			invocation.response?.bodyText,
		);
		supplemental.push({
			operation: invocation.operation,
			layer: invocation.layer,
			invocationIndex: invocation.invocationIndex,
			traceId: invocation.traceId,
			providerRequestId: invocation.providerRequestId,
			requestChecks: entryChecks(invocation.request),
			responseChecks: entryChecks(invocation.response),
			...(requestRaw ? { requestBodyRaw: requestRaw } : {}),
			...(responseRaw ? { responseBodyRaw: responseRaw } : {}),
		});
	}

	const lifecyclePath = join(orderDir, "lifecycle.jsonl");
	const lifecycle = records
		.map((record) =>
			JSON.stringify({
				time: record.time,
				unit: record.unit,
				message: record.message,
			}),
		)
		.join("\n");
	await writeFile(lifecyclePath, `${lifecycle}${lifecycle ? "\n" : ""}`, {
		encoding: "utf8",
		mode: 0o600,
	});
	await chmod(lifecyclePath, 0o600);

	const completePrimary = primary.filter(
		(invocation) =>
			invocation.request?.complete && invocation.response?.complete,
	).length;
	const completeness = {
		status:
			primary.length > 0 && completePrimary === primary.length
				? "COMPLETE_FOR_ALL_OBSERVED_TRANSPORT_INVOCATIONS"
				: "INCOMPLETE",
		allRequestsPresent: primary.every((invocation) =>
			Boolean(invocation.request),
		),
		allResponsesPresent: primary.every((invocation) =>
			Boolean(invocation.response),
		),
		allChunkIndicesComplete: primary.every(
			(invocation) =>
				invocation.request?.complete && invocation.response?.complete,
		),
		fsiSupplementalEvidenceObserved: supplemental.some(
			(item) => item.layer === "logical" || item.layer === "legacy",
		),
	};
	const manifest = {
		exportType: "payment-day-provider-raw-trace",
		orderId: order.orderId,
		...(order.appointmentId ? { appointmentId: order.appointmentId } : {}),
		started: shanghaiIso(order.started),
		lastObservedTime: shanghaiIso(records.at(-1)?.time || order.started),
		status: orderStatus(records, invocations),
		statusNote: Object.keys(eventSummary(records)).join(", "),
		actualInterfaceCount: interfaceRows.length,
		completeness,
		eventCounts: eventSummary(records),
		interfaces: interfaceRows,
		supplementalEvidence: supplemental,
		lifecyclePath,
		matchedJournalRecords: trace.matchedJournalRecords,
	};
	const manifestFile = await writeJson(
		join(orderDir, "manifest.json"),
		manifest,
	);
	return {
		...manifest,
		identifiers: [...order.identifiers],
		manifestPath: manifestFile.path,
		orderDir,
		interfaceRows,
	};
}

function selectedJournalLines(records, orders) {
	const identifiers = new Set();
	for (const order of orders) {
		for (const value of order.identifiers) identifiers.add(value);
		if (order.appointmentId) identifiers.add(order.appointmentId);
	}
	return records
		.filter((record) => {
			if (PAYMENT_EVENT.test(record.message.event)) return true;
			const line = record.line;
			for (const identifier of identifiers) {
				if (line.includes(identifier)) return true;
			}
			return false;
		})
		.map((record) => record.line)
		.join("\n");
}

function markdownIndex(date, orders, { latest = false } = {}) {
	const lines = [
		`# ${date} 3090 ${latest ? "最新一笔支付" : "全日支付"}原始日志`,
		"",
		"每笔支付列出开始时间；每个实际接口均对应独立 `request.json` / `response.json`。",
		"JSON 文件直接展示明文请求/返回；`request-body.raw` / `response-body.raw` 保留 Provider 原始正文，供完整性核验。",
		"",
	];
	if (orders.length === 0) {
		lines.push("指定时间窗口内未识别到带 `orderId` 的支付订单。", "");
	}
	for (const [index, order] of orders.entries()) {
		lines.push(`## ${index + 1}. ${order.orderId}`, "");
		if (order.appointmentId)
			lines.push(`- appointmentId: \`${order.appointmentId}\``);
		lines.push(
			`- started: \`${order.started}\``,
			"",
			"| # | 接口 | 入参 JSON | 返回 JSON |",
			"|---:|---|---|---|",
		);
		for (const row of order.interfaceRows) {
			lines.push(
				`| ${row.ordinal} | ${row.displayOperation}${row.invocationIndex ? `（重试 ${row.invocationIndex + 1}）` : ""} | [request.json](${row.requestPath}) | [response.json](${row.responsePath}) |`,
			);
		}
		lines.push("");
	}
	return `${lines.join("\n")}\n`;
}

async function createArchive(outputDir, date, latest = false) {
	const archiveName = latest ? "latest-payment" : "all-payments";
	const archivePath = join(
		outputDir,
		`${archiveName}-${date.replaceAll("-", "")}-provider-jsons.tar.gz`,
	);
	const relative = [
		"daily-manifest.json",
		"daily-index.md",
		"selected-journald-envelopes.jsonl",
		"orders",
	];
	await runProcess("tar", ["-czf", archivePath, "-C", outputDir, ...relative], {
		maxBytes: 2 * 1024 * 1024,
	});
	await chmod(archivePath, 0o600);
	const bytes = await readFile(archivePath);
	return {
		path: archivePath,
		bytes: bytes.byteLength,
		sha256: sha256Bytes(bytes),
	};
}

async function ensureControlledDirectory(path) {
	await mkdir(path, { recursive: true, mode: 0o700 });
	await chmod(path, 0o700);
}

function defaultOutputDir(date, latest = false) {
	const root =
		process.env.PAYMENT_LOG_OUTPUT_ROOT ||
		(platform() === "darwin"
			? "/private/tmp/hospital-platform-secure-logs"
			: join(tmpdir(), "hospital-platform-secure-logs"));
	const stamp = new Date()
		.toISOString()
		.replace(/[-:TZ.]/gu, "")
		.slice(0, 14);
	const prefix = latest ? "payment-latest" : "payments-day";
	return join(root, `${prefix}-${date}-${stamp}`);
}

async function main(args = process.argv.slice(2)) {
	const options = parseArgs(args);
	const requestedWindow = shanghaiWindow(
		options.date,
		options.since,
		options.until,
	);
	const window = options.latest
		? latestCaptureWindow(requestedWindow)
		: requestedWindow;
	const outputDir = resolve(
		options.outputDir || defaultOutputDir(options.date, options.latest),
	);
	await ensureControlledDirectory(outputDir);
	const ordersRoot = join(outputDir, "orders");
	await mkdir(ordersRoot, { recursive: true, mode: 0o700 });
	await chmod(ordersRoot, 0o700);

	const serialized = options.inputFile
		? await readFile(options.inputFile, "utf8")
		: await remoteJournal(options, window);
	const journalBytes = Buffer.byteLength(serialized);
	if (journalBytes > MAX_JOURNAL_BYTES)
		throw new Error("日志窗口超过 64 MiB，请缩短时间范围");
	const journalPath = join(outputDir, "journal.jsonl");
	await writeFile(journalPath, serialized, { encoding: "utf8", mode: 0o600 });
	await chmod(journalPath, 0o600);
	const journalSha = sha256Text(serialized);

	const parsed = parseRecords(serialized);
	const allOrders = collectOrders(parsed.records);
	const requestedSince = Date.parse(requestedWindow.sinceIso);
	const requestedUntil = Date.parse(requestedWindow.untilIso);
	const eligibleOrders = allOrders.filter((order) => {
		const started = Date.parse(order.started);
		return started >= requestedSince && started <= requestedUntil;
	});
	const orders = options.latest ? eligibleOrders.slice(-1) : allOrders;
	const orderResults = [];
	for (const order of orders) {
		orderResults.push(
			await writeOrder(order, serialized, window, outputDir, allOrders),
		);
	}

	const selected = selectedJournalLines(parsed.records, orders);
	const selectedPath = join(outputDir, "selected-journald-envelopes.jsonl");
	await writeFile(selectedPath, `${selected}${selected ? "\n" : ""}`, {
		encoding: "utf8",
		mode: 0o600,
	});
	await chmod(selectedPath, 0o600);

	const indexPath = join(outputDir, "daily-index.md");
	const indexContent = markdownIndex(options.date, orderResults, {
		latest: options.latest,
	});
	await writeFile(indexPath, indexContent, { encoding: "utf8", mode: 0o600 });
	await chmod(indexPath, 0o600);

	const lastObservedJournalTime = parsed.records.at(-1)?.time;
	const unmatchedPaymentEvents = parsed.records
		.filter(
			(record) =>
				ORDER_PAYMENT_EVENT.test(record.message.event) &&
				!stringValue(record.message.orderId),
		)
		.map((record) => ({
			time: shanghaiIso(record.time),
			event: record.message.event,
			traceId: stringValue(record.message.traceId),
		}));
	const allInterfaces = orderResults.flatMap((order) => order.interfaceRows);
	const incompleteOrders = orderResults.filter(
		(order) =>
			order.completeness.status !==
			"COMPLETE_FOR_ALL_OBSERVED_TRANSPORT_INVOCATIONS",
	);
	const dailyManifest = {
		exportType: options.latest
			? "latest-payment-provider-raw-trace"
			: "all-payments-day-provider-raw-traces",
		createdAt: new Date().toISOString(),
		requestedWindow: `${shanghaiIso(requestedWindow.sinceIso)} to ${shanghaiIso(requestedWindow.untilIso)}`,
		captureWindow: `${shanghaiIso(window.sinceIso)} to ${shanghaiIso(window.untilIso)}`,
		services: JOURNAL_UNITS,
		journalSource: {
			path: journalPath,
			bytes: journalBytes,
			sha256: journalSha,
			format: "journalctl --all -o json --no-pager",
			messageNullCount: parsed.records.filter(
				(record) => record.envelope.MESSAGE == null,
			).length,
			malformedEnvelopeCount: parsed.malformedEnvelopeCount,
			malformedMessageCount: parsed.malformedMessageCount,
			lastObservedJournalTime: lastObservedJournalTime
				? shanghaiIso(lastObservedJournalTime)
				: undefined,
		},
		selectedJournaldEvidence: {
			path: selectedPath,
			bytes: Buffer.byteLength(`${selected}${selected ? "\n" : ""}`),
			sha256: sha256Text(`${selected}${selected ? "\n" : ""}`),
		},
		paymentOrderCount: orderResults.length,
		unmatchedPaymentEvents,
		paymentOrders: orderResults.map((order) => ({
			orderId: order.orderId,
			...(order.appointmentId ? { appointmentId: order.appointmentId } : {}),
			started: order.started,
			status: order.status,
			interfaceCount: order.actualInterfaceCount,
			manifestPath: order.manifestPath,
			interfaces: order.interfaceRows.map((row) => ({
				ordinal: row.ordinal,
				operation: row.operation,
				displayOperation: row.displayOperation,
				displayLayer: row.displayLayer,
				invocationIndex: row.invocationIndex,
				requestPath: row.requestPath,
				responsePath: row.responsePath,
			})),
		})),
		rawTraceCompleteness: {
			status:
				incompleteOrders.length === 0
					? "COMPLETE_FOR_ALL_OBSERVED_INVOCATIONS"
					: "INCOMPLETE",
			everyOrderHasRequestAndResponse: orderResults.every(
				(order) =>
					order.completeness.allRequestsPresent &&
					order.completeness.allResponsesPresent,
			),
			incompleteOrders: incompleteOrders.map((order) => order.orderId),
			rawSensitiveContentKeptInMode600Files: true,
		},
		notes: [
			`识别到 ${orderResults.length} 个带 orderId 的支付订单记录；脚本不会把未来尚未产生的订单计入本快照。`,
			...(options.latest
				? [
						"本次为最新一笔模式，只保留请求时间窗口内开始时间最新的支付订单；采集窗口自动向前回看 2 分钟以收齐首个请求。",
					]
				: []),
			...(unmatchedPaymentEvents.length > 0
				? [
						`另有 ${unmatchedPaymentEvents.length} 条支付事件没有 orderId，已列入 manifest 的 unmatchedPaymentEvents，未擅自归入订单。`,
					]
				: []),
			`解析到 ${parsed.records.length} 条应用 JSON 日志，${allInterfaces.length} 个实际传输调用。`,
		],
	};
	const manifestPath = join(outputDir, "daily-manifest.json");
	await writeJson(manifestPath, dailyManifest);
	if (!options.noArchive)
		await createArchive(outputDir, options.date, options.latest);

	console.log(indexPath);
}

if (import.meta.main) {
	try {
		await main();
	} catch (error) {
		console.error(
			error instanceof Error ? error.message : "payment-day-export failed",
		);
		usage();
		process.exitCode = 1;
	}
}

export {
	assignRawEntriesToOrder,
	collectOrders,
	displayOperation,
	expandNestedJson,
	main,
	pairRawEntries,
	parseBody,
	parseRecords,
	shanghaiWindow,
};
