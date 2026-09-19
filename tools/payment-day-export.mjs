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
const SELF_PAY_QUERY_HTTP_EVENTS = new Set([
	"http.request.completed",
	"http.request.failed",
]);
const SELF_PAY_SETTLEMENT_EVENT =
	/^(?:outpatient|appointment)\.self-payment\.(?:his-context-pending|provider-settlement-(?:pending|succeeded))$/u;
const SELF_PAY_QUERY_ROUTES = Object.freeze([
	{
		kind: "outpatient",
		pattern: /^\/api\/v1\/payments\/outpatient\/records\/([^/?#]+)\/self-pay$/u,
	},
	{
		kind: "appointment",
		pattern: /^\/api\/v1\/payments\/appointments\/([^/?#]+)\/self-pay$/u,
	},
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

function selectOrdersForWindow(allOrders, requestedWindow, latest = false) {
	const requestedSince = Date.parse(requestedWindow.sinceIso);
	const requestedUntil = Date.parse(requestedWindow.untilIso);
	const eligible = allOrders.filter((order) => {
		const started = Date.parse(order.started);
		return started >= requestedSince && started <= requestedUntil;
	});
	return latest ? eligible.slice(-1) : eligible;
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
		recordIds: new Set(),
		identifiers: new Set([orderId]),
		traceBridges: [],
	};
}

function selfPayQueryResource(record) {
	const message = record.message;
	if (
		!SELF_PAY_QUERY_HTTP_EVENTS.has(message.event) ||
		message.method !== "GET"
	)
		return undefined;
	const path = stringValue(message.path);
	const traceId = stringValue(message.traceId);
	if (!path || !traceId) return undefined;
	for (const route of SELF_PAY_QUERY_ROUTES) {
		const match = path.match(route.pattern);
		const resourceId = stringValue(match?.[1]);
		if (resourceId && resourceId.length <= 512) {
			return { kind: route.kind, path, resourceId, traceId };
		}
	}
	return undefined;
}

function collectOrdersWithDiagnostics(records) {
	const orders = new Map();
	for (const record of records) {
		const seed = orderSeed(record);
		if (!seed) continue;
		if (!orders.has(seed)) orders.set(seed, createOrder(record, seed));
	}
	const ordered = [...orders.values()].sort((left, right) =>
		left.started.localeCompare(right.started),
	);
	const assignedRecords = new Set();
	const traceBridgeDiagnostics = { matched: [], ambiguous: [], unmatched: [] };
	const addRecord = (order, record) => {
		if (assignedRecords.has(record)) return;
		order.records.push(record);
		assignedRecords.add(record);
		const m = record.message;
		if (!order.appointmentId)
			order.appointmentId = stringValue(m.appointmentId);
		const recordId = stringValue(m.recordId);
		if (recordId) order.recordIds.add(recordId);
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
	// seed 事件不一定是本笔链路中最早带 orderId 的事件；用已经明确归单的
	// 非 Worker 记录校正开始时间，避免把后续查单误当作支付真正开始时间，
	// 也避免历史后台补偿事件把新一笔支付回拨到请求窗口之外。
	for (const order of ordered) {
		for (const record of order.records) {
			if (
				!record.message.event.startsWith("worker.payment.") &&
				record.time < order.started
			)
				order.started = record.time;
		}
	}
	ordered.sort((left, right) => left.started.localeCompare(right.started));
	for (const record of records) {
		const m = record.message;
		if (assignedRecords.has(record)) continue;
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

	// 支付后的 GET 查单会生成全新的 traceId，而业务结果事件只携带
	// orderId + recordId/appointmentId。通过两个受信自费查单路由把新 trace
	// 精确桥接回订单，才能继续收齐该 trace 下的 .29/.15/.5 原始报文。
	// 必须同时满足“查询不早于订单开始”且“查询前 5 秒内只有一笔候选订单
	// 出现明确 HIS/Provider 结算事件”；缺证据或多候选时一律 fail closed。
	for (const record of records) {
		if (assignedRecords.has(record)) continue;
		const resource = selfPayQueryResource(record);
		if (!resource) continue;
		const resourceCandidates = ordered.filter((order) =>
			resource.kind === "outpatient"
				? order.recordIds.has(resource.resourceId)
				: order.appointmentId === resource.resourceId,
		);
		const completedAt = Date.parse(record.time);
		const candidates = resourceCandidates.filter(
			(order) => completedAt >= Date.parse(order.started),
		);
		const evidenced = candidates.filter((order) =>
			order.records.some((candidateRecord) => {
				const distance = completedAt - Date.parse(candidateRecord.time);
				return (
					distance >= 0 &&
					distance <= 5_000 &&
					SELF_PAY_SETTLEMENT_EVENT.test(candidateRecord.message.event)
				);
			}),
		);
		const selected = evidenced.length === 1 ? evidenced[0] : undefined;
		if (!selected) {
			if (evidenced.length > 1) {
				traceBridgeDiagnostics.ambiguous.push({
					time: shanghaiIso(record.time),
					traceId: resource.traceId,
					kind: resource.kind,
					resourceId: resource.resourceId,
					candidateOrderIds: evidenced.map((order) => order.orderId),
				});
			} else {
				traceBridgeDiagnostics.unmatched.push({
					time: shanghaiIso(record.time),
					traceId: resource.traceId,
					kind: resource.kind,
					resourceId: resource.resourceId,
					reason:
						resourceCandidates.length === 0
							? "no-resource-candidate"
							: candidates.length === 0
								? "candidate-starts-after-query"
								: "no-nearby-settlement-evidence",
					candidateOrderIds: resourceCandidates.map((order) => order.orderId),
				});
			}
			continue;
		}
		addRecord(selected, record);
		const bridge = {
			time: shanghaiIso(record.time),
			traceId: resource.traceId,
			kind: resource.kind,
			resourceId: resource.resourceId,
			orderId: selected.orderId,
		};
		selected.traceBridges.push(bridge);
		traceBridgeDiagnostics.matched.push(bridge);
	}
	for (const order of ordered) {
		order.records.sort((left, right) => left.time.localeCompare(right.time));
	}
	return { orders: ordered, traceBridgeDiagnostics };
}

function collectOrders(records) {
	return collectOrdersWithDiagnostics(records).orders;
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
		// 不按“时间最近”猜测归属：并发支付时这会把别人的 Provider 原文串单。
		// 未通过 trace/request/providerRequestId 精确关联的报文必须保持未归属。
		return false;
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
		events.has("medical-insurance.2.6.65.5.completed") ||
		events.has("appointment.self-payment.provider-settlement-succeeded") ||
		events.has("outpatient.self-payment.provider-settlement-succeeded")
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
	const observedStart = [
		order.started,
		...primary.flatMap((invocation) =>
			[invocation.request?.timestamp, invocation.response?.timestamp].filter(
				Boolean,
			),
		),
	].sort()[0];
	const observedEnd = [
		records.at(-1)?.time || order.started,
		...invocations.flatMap((invocation) =>
			[invocation.request?.timestamp, invocation.response?.timestamp].filter(
				Boolean,
			),
		),
	]
		.sort()
		.at(-1);
	const interfaceRows = [];
	const operationTotals = new Map();
	for (const invocation of primary) {
		operationTotals.set(
			invocation.operation,
			(operationTotals.get(invocation.operation) || 0) + 1,
		);
	}
	const operationAttempts = new Map();
	let ordinal = 0;
	for (const invocation of primary) {
		ordinal += 1;
		const operationAttempt =
			(operationAttempts.get(invocation.operation) || 0) + 1;
		operationAttempts.set(invocation.operation, operationAttempt);
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
			operationAttempt,
			operationTotal: operationTotals.get(invocation.operation) || 1,
			timestamp:
				displayInvocation.request?.timestamp ||
				displayInvocation.response?.timestamp,
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
			primary.length > 0 &&
			completePrimary === primary.length &&
			!trace.truncated
				? "COMPLETE_FOR_ALL_CORRELATED_TRANSPORT_INVOCATIONS"
				: "INCOMPLETE",
		scope: "correlated-order-identifiers-and-exact-self-pay-query-routes",
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
		rawTraceTruncated: trace.truncated,
	};
	const manifest = {
		exportType: "payment-day-provider-raw-trace",
		orderId: order.orderId,
		...(order.appointmentId ? { appointmentId: order.appointmentId } : {}),
		started: shanghaiIso(observedStart || order.started),
		lastObservedTime: shanghaiIso(observedEnd || order.started),
		status: orderStatus(records, invocations),
		statusNote: Object.keys(eventSummary(records)).join(", "),
		actualInterfaceCount: interfaceRows.length,
		traceBridgeCount: order.traceBridges.length,
		traceBridges: order.traceBridges,
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

function markdownIndex(
	date,
	orders,
	{
		latest = false,
		requestedWindow,
		captureWindow,
		lastObservedJournalTime,
		unmatchedPaymentEventCount = 0,
		traceBridgeDiagnostics = { matched: [], ambiguous: [], unmatched: [] },
	} = {},
) {
	const totalInterfaces = orders.reduce(
		(total, order) => total + order.actualInterfaceCount,
		0,
	);
	const incompleteOrders = orders.filter(
		(order) =>
			order.completeness.status !==
			"COMPLETE_FOR_ALL_CORRELATED_TRANSPORT_INVOCATIONS",
	);
	const completenessStatus =
		orders.length === 0
			? "NO_PAYMENT_ORDER_OBSERVED"
			: incompleteOrders.length === 0
				? "COMPLETE_FOR_ALL_CORRELATED_INVOCATIONS"
				: "INCOMPLETE";
	const lines = [
		`# ${date} 3090 ${latest ? "最新一笔支付" : "全日支付"}原始日志`,
		"",
		"每笔支付列出开始时间；每个已关联的实际接口均对应独立 `request.json` / `response.json`。",
		"JSON 文件直接展示明文请求/返回；`request-body.raw` / `response-body.raw` 保留 Provider 原始正文，供完整性核验。",
		"",
		"## 采集与完整性",
		"",
		...(requestedWindow ? [`- 请求窗口：\`${requestedWindow}\``] : []),
		...(captureWindow ? [`- 采集窗口：\`${captureWindow}\``] : []),
		...(lastObservedJournalTime
			? [`- 原始日志最后观测时间：\`${lastObservedJournalTime}\``]
			: []),
		`- 支付订单数：\`${orders.length}\``,
		`- 已关联接口调用数：\`${totalInterfaces}\``,
		`- 支付后查单 trace 桥接：\`${traceBridgeDiagnostics.matched.length}\` 条；歧义未归属：\`${traceBridgeDiagnostics.ambiguous.length}\` 条；缺少候选或结算证据：\`${traceBridgeDiagnostics.unmatched.length}\` 条`,
		`- 未归入订单的支付事件：\`${unmatchedPaymentEventCount}\` 条`,
		`- 原始报文完整性：\`${completenessStatus}\``,
		"- 完整性只表示已通过订单标识或受信自费查单路由关联到本订单的调用，其请求、返回和 chunk 均齐全，并且日志中存在的字节长度/摘要元数据校验通过；不代表采集截止时间之后或无法安全关联的调用不存在。",
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
			`- lastObservedTime: \`${order.lastObservedTime}\``,
			`- status: \`${order.status}\``,
			`- interfaceCount: \`${order.actualInterfaceCount}\``,
			`- postPaymentQueryTraceCount: \`${order.traceBridgeCount}\``,
			`- rawCompleteness: \`${order.completeness.status}\``,
			"",
			"| # | 接口 | 入参 JSON | 返回 JSON |",
			"|---:|---|---|---|",
		);
		for (const row of order.interfaceRows) {
			const occurrence =
				row.operationTotal > 1
					? `（第 ${row.operationAttempt}/${row.operationTotal} 次）`
					: "";
			lines.push(
				`| ${row.ordinal} | ${row.displayOperation}${occurrence} | [request.json](${row.requestPath}) | [response.json](${row.responsePath}) |`,
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
	const { orders: allOrders, traceBridgeDiagnostics } =
		collectOrdersWithDiagnostics(parsed.records);
	const orders = selectOrdersForWindow(
		allOrders,
		requestedWindow,
		options.latest,
	);
	const selectedOrderIds = new Set(orders.map((order) => order.orderId));
	const selectedTraceBridgeDiagnostics = {
		matched: traceBridgeDiagnostics.matched.filter((bridge) =>
			selectedOrderIds.has(bridge.orderId),
		),
		ambiguous: traceBridgeDiagnostics.ambiguous.filter((bridge) =>
			bridge.candidateOrderIds.some((orderId) => selectedOrderIds.has(orderId)),
		),
		unmatched: traceBridgeDiagnostics.unmatched.filter(
			(bridge) =>
				!options.latest ||
				bridge.candidateOrderIds.some((orderId) =>
					selectedOrderIds.has(orderId),
				),
		),
	};
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

	const lastObservedJournalTime = parsed.records.reduce(
		(latest, record) =>
			!latest || record.time > latest ? record.time : latest,
		undefined,
	);
	const assignedRecords = new Set(allOrders.flatMap((order) => order.records));
	const unmatchedPaymentEvents = parsed.records
		.filter(
			(record) =>
				ORDER_PAYMENT_EVENT.test(record.message.event) &&
				!assignedRecords.has(record),
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
			"COMPLETE_FOR_ALL_CORRELATED_TRANSPORT_INVOCATIONS",
	);
	const requestedWindowText = `${shanghaiIso(requestedWindow.sinceIso)} to ${shanghaiIso(requestedWindow.untilIso)}`;
	const captureWindowText = `${shanghaiIso(window.sinceIso)} to ${shanghaiIso(window.untilIso)}`;
	const indexPath = join(outputDir, "daily-index.md");
	const indexContent = markdownIndex(options.date, orderResults, {
		latest: options.latest,
		requestedWindow: requestedWindowText,
		captureWindow: captureWindowText,
		lastObservedJournalTime: lastObservedJournalTime
			? shanghaiIso(lastObservedJournalTime)
			: undefined,
		unmatchedPaymentEventCount: unmatchedPaymentEvents.length,
		traceBridgeDiagnostics: selectedTraceBridgeDiagnostics,
	});
	await writeFile(indexPath, indexContent, { encoding: "utf8", mode: 0o600 });
	await chmod(indexPath, 0o600);

	const dailyManifest = {
		exportType: options.latest
			? "latest-payment-provider-raw-trace"
			: "all-payments-day-provider-raw-traces",
		createdAt: new Date().toISOString(),
		requestedWindow: requestedWindowText,
		captureWindow: captureWindowText,
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
		traceBridgeDiagnostics: selectedTraceBridgeDiagnostics,
		paymentOrders: orderResults.map((order) => ({
			orderId: order.orderId,
			...(order.appointmentId ? { appointmentId: order.appointmentId } : {}),
			started: order.started,
			lastObservedTime: order.lastObservedTime,
			status: order.status,
			interfaceCount: order.actualInterfaceCount,
			traceBridgeCount: order.traceBridgeCount,
			completeness: order.completeness,
			manifestPath: order.manifestPath,
			interfaces: order.interfaceRows.map((row) => ({
				ordinal: row.ordinal,
				operation: row.operation,
				displayOperation: row.displayOperation,
				displayLayer: row.displayLayer,
				invocationIndex: row.invocationIndex,
				operationAttempt: row.operationAttempt,
				operationTotal: row.operationTotal,
				timestamp: row.timestamp,
				requestPath: row.requestPath,
				responsePath: row.responsePath,
			})),
		})),
		rawTraceCompleteness: {
			status:
				orderResults.length === 0
					? "NO_PAYMENT_ORDER_OBSERVED"
					: incompleteOrders.length === 0
						? "COMPLETE_FOR_ALL_CORRELATED_INVOCATIONS"
						: "INCOMPLETE",
			scope: "correlated-order-identifiers-and-exact-self-pay-query-routes",
			everyOrderHasRequestAndResponse: orderResults.every(
				(order) =>
					order.completeness.allRequestsPresent &&
					order.completeness.allResponsesPresent,
			),
			incompleteOrders: incompleteOrders.map((order) => order.orderId),
			matchedSelfPayQueryTraceCount:
				selectedTraceBridgeDiagnostics.matched.length,
			ambiguousSelfPayQueryTraceCount:
				selectedTraceBridgeDiagnostics.ambiguous.length,
			unmatchedSelfPayQueryTraceCount:
				selectedTraceBridgeDiagnostics.unmatched.length,
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
						`另有 ${unmatchedPaymentEvents.length} 条支付事件无法安全归入订单，已列入 manifest 的 unmatchedPaymentEvents。`,
					]
				: []),
			...(selectedTraceBridgeDiagnostics.ambiguous.length > 0
				? [
						`另有 ${selectedTraceBridgeDiagnostics.ambiguous.length} 条支付后自费查单 trace 同时匹配多笔订单且没有唯一结算证据，已保持未归属。`,
					]
				: []),
			...(selectedTraceBridgeDiagnostics.unmatched.length > 0
				? [
						`另有 ${selectedTraceBridgeDiagnostics.unmatched.length} 条自费查单 trace 缺少订单候选或查询附近的唯一结算证据，已保持未归属。`,
					]
				: []),
			"完整性状态只覆盖通过订单标识或受信自费查单路由已关联的调用，不推断采集截止时间之后或无法安全关联的调用。",
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
	selectOrdersForWindow,
	shanghaiWindow,
};
