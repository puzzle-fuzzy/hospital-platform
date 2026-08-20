import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";

const SAFE_LABEL_PATTERN = /^[A-Za-z0-9_.:-]{1,96}$/u;
const MAX_DISTINCT_LABELS = 200;
const MAX_CORRELATION_CHAINS = 256;
/** 与 domain trace contract 对齐，防止异常日志数组消耗无界聚合资源。 */
const MAX_PROVIDER_REQUEST_IDS = 8;

/**
 * P0 日志聚合只消费 journald 导出的 JSONL，不参与业务请求，也不改变线上状态。
 * 事件名、错误类型和状态码都是有限的诊断维度；原始 msg、URL、请求体、用户标识、
 * 患者标识和金额一律不进入聚合结果，避免“为了排障而复制敏感日志”。
 */
function safeLabel(value) {
	if (typeof value !== "string" && typeof value !== "number") return null;
	const label = String(value).trim();
	return SAFE_LABEL_PATTERN.test(label) ? label : null;
}

/**
 * 提取单请求和多请求 trace 的低敏请求号。
 *
 * 业务日志保留兼容的 `providerRequestId`，多请求场景再写入已由 domain
 * 校验的 `providerRequestIds`。聚合器不能只读主字段，否则报告/患者档案
 * 等多次 Provider 调用会被错误汇总成一次；这里再次限制数组长度和 label
 * 形状，避免异常日志反过来拖垮证据工具。集合去重由调用方负责。
 */
function providerRequestIdLabels(record) {
	const labels = [];
	const primary = safeLabel(record.providerRequestId);
	if (primary) labels.push(primary);
	if (Array.isArray(record.providerRequestIds)) {
		for (const value of record.providerRequestIds.slice(
			0,
			MAX_PROVIDER_REQUEST_IDS,
		)) {
			const label = safeLabel(value);
			if (label) labels.push(label);
		}
	}
	return labels;
}

function increment(map, key) {
	map.set(key, (map.get(key) ?? 0) + 1);
}

function sortedCounts(map) {
	return Object.fromEntries(
		[...map.entries()].sort(([left], [right]) => left.localeCompare(right)),
	);
}

/**
 * `journalctl -o cat` 会把 systemd 自己写入同一 unit 的启动/停止提示混在应用
 * JSONL 中。这些固定控制行不是业务日志，但也不是解析失败；只忽略明确白名单中的
 * 文本，其他非 JSON 内容仍然计入 `parseErrors`，避免真正的异常文本被静默吞掉。
 */
function isExpectedJournalControlLine(line) {
	return /^(?:Stopping|Stopped|Started) Hospital Platform API v2 \(Bun \+ Elysia\)(?:\.{3}|\.)?$|^hospital-platform-api-v2\.service: (?:Deactivated successfully\.|Consumed .+ CPU time\.)$/u.test(
		line,
	);
}

/**
 * systemd 的停止超时不是应用 JSON 解析错误，但也绝不能被当作普通控制行吞掉。
 * 这里只提取固定的稳定原因，不保留 PID、进程名或 systemd 原文；业务证据门禁会
 * 因为存在这类 warning 保持失败，避免“服务被 SIGKILL 后仍然算业务验收通过”。
 */
function classifyJournalLine(line) {
	if (isExpectedJournalControlLine(line)) return { kind: "control" };
	if (
		/^hospital-platform-api-v2\.service: State 'stop-[A-Za-z0-9_-]+' timed out\. Killing\.$/u.test(
			line,
		)
	)
		return { kind: "warning", warningCode: "service-stop-timeout" };
	if (
		/^hospital-platform-api-v2\.service: Killing process [0-9]+ \([A-Za-z0-9_.-]+\) with signal SIGKILL\.$/u.test(
			line,
		)
	)
		return { kind: "warning", warningCode: "process-killed" };
	if (
		/^hospital-platform-api-v2\.service: Main process exited, code=killed, status=[0-9]+\/KILL$/u.test(
			line,
		)
	)
		return { kind: "warning", warningCode: "main-process-killed" };
	if (
		/^hospital-platform-api-v2\.service: Failed with result 'timeout'\.$/u.test(
			line,
		)
	)
		return { kind: "warning", warningCode: "service-timeout-failed" };
	return null;
}

/**
 * journald 的 `-o json` 会把应用原始 stdout 放进 MESSAGE 字段，而不是直接把
 * Pino JSON 作为整行输出。先拆出 MESSAGE 再解析，才能避免长日志在终端宽度边界
 * 被拆行或混入控制字符；同时保留 `-o cat` 的兼容输入，方便旧手册和历史窗口继续
 * 复核。返回值只包含“应用记录 / 已知 systemd 控制行 / 解析失败”三种结果，不保留
 * journald 的主机、进程和游标元数据，避免把基础设施字段带入业务聚合。
 */
function parseInputRecord(line) {
	let parsed;
	try {
		parsed = JSON.parse(line);
	} catch {
		const journalLine = classifyJournalLine(line.trim());
		if (journalLine) return journalLine;
		return { kind: "error" };
	}

	if (
		parsed &&
		typeof parsed === "object" &&
		!Array.isArray(parsed) &&
		typeof parsed.MESSAGE === "string"
	) {
		const message = parsed.MESSAGE.replace(/^\uFEFF/u, "");
		try {
			parsed = JSON.parse(message);
		} catch {
			const journalLine = classifyJournalLine(message.trim());
			if (journalLine) return journalLine;
			return { kind: "error" };
		}
	}

	if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
		return { kind: "error" };
	}
	return { kind: "record", record: parsed };
}

/** 将稳定事件名归入业务域，便于一眼判断真机请求是否已经到达目标模块。 */
export function classifyDomain(event) {
	if (event.startsWith("auth.wechat.")) return "auth";
	if (event.startsWith("patient.directory.")) return "patient";
	if (event.startsWith("appointment.")) return "appointment";
	if (event.startsWith("outpatient.payment.")) return "outpatient";
	if (event.startsWith("user.profile.")) return "profile";
	if (event.startsWith("report.")) return "report";
	if (event.startsWith("payment.")) return "payment-frozen";
	if (
		event.startsWith("service.") ||
		event.startsWith("runtime.") ||
		event.startsWith("http.request.") ||
		event.startsWith("persistence.")
	)
		return "infrastructure";
	return "other";
}

/**
 * 失败分类以事件名和 HTTP 状态为准，不读取 msg 或第三方原始错误文本。
 * `in_progress`/`conflict` 单独保留，避免把并发冲突误报成依赖故障。
 */
export function classifyOutcome(event, record) {
	const statusCode =
		typeof record.statusCode === "number" ? record.statusCode : Number.NaN;
	if (Number.isInteger(statusCode) && statusCode >= 400) return "failure";
	if (/(?:conflict|in_progress)/u.test(event)) return "conflict";
	if (/(?:failed|rejected|unavailable|error|timeout)/u.test(event))
		return "failure";
	if (/(?:warning)/u.test(event)) return "warning";
	if (
		/(?:succeeded|completed|passed|loaded|synced|recovered|recorded|processed)/u.test(
			event,
		)
	)
		return "success";
	if (/(?:requested|started|claimed|checked)/u.test(event)) return "requested";
	return "other";
}

function addBoundedLabel(map, value) {
	const label = safeLabel(value);
	if (!label) return;
	if (!map.has(label) && map.size >= MAX_DISTINCT_LABELS) {
		increment(map, "label-limit-reached");
		return;
	}
	increment(map, label);
}

/**
 * 把 traceId/requestId 转成只用于本次证据窗口的关联指纹。
 *
 * 原始链路标识虽然不是患者正文，但直接输出仍会扩大日志传播范围；业务
 * 门禁只需要知道“请求和成功是否来自同一条链”，不需要知道标识本身。这里
 * 使用完整 SHA-256 指纹，输出只保留事件计数；同一窗口内的相同链路仍能被
 * 关联，原始 trace/request 值不会进入聚合摘要。
 */
function correlationFingerprint(value) {
	return createHash("sha256").update(value, "utf8").digest("hex");
}

/**
 * 将受限关联桶转换为稳定排序的安全摘要。
 *
 * 业务成功事件是在 service 层产生的，HTTP 完成事件是在路由/响应层产生的；
 * 两者必须同时存在，才能证明“业务结果最终真正返回给客户端”。因此关联桶
 * 除了事件计数，还单独保留 `http.request.completed` 的状态码计数。只保留
 * 有界状态码，不复制 URL、响应体或原始日志。
 */
function sortedCorrelationChains(chains) {
	return Object.fromEntries(
		[...chains.entries()]
			.sort(([left], [right]) => left.localeCompare(right))
			.map(([fingerprint, chain]) => [
				fingerprint,
				{
					events: sortedCounts(chain.events),
					httpCompletedStatusCounts: sortedCounts(
						chain.httpCompletedStatusCounts,
					),
				},
			]),
	);
}

/** 对一组 journald JSONL 行生成不含原始业务内容的聚合摘要。 */
export function aggregateLines(lines) {
	const eventCounts = new Map();
	const domainCounts = new Map();
	const outcomeCounts = new Map();
	const httpStatusCounts = new Map();
	const errorTypeCounts = new Map();
	const systemdWarningCounts = new Map();
	const traceIds = new Set();
	const providerRequestIds = new Set();
	const correlationChains = new Map();
	let inputLines = 0;
	let parsedRecords = 0;
	let parseErrors = 0;
	let ignoredBlankLines = 0;
	let ignoredControlLines = 0;
	let strippedBomLines = 0;
	let correlationRecordCount = 0;
	let correlationMissingCount = 0;
	let correlationTruncated = false;

	for (const inputLine of lines) {
		inputLines += 1;
		if (typeof inputLine !== "string") {
			parseErrors += 1;
			continue;
		}
		let line = inputLine;
		if (line.startsWith("\uFEFF")) {
			strippedBomLines += 1;
			line = line.slice(1);
		}
		if (line.trim() === "") {
			ignoredBlankLines += 1;
			continue;
		}
		const parsedInput = parseInputRecord(line);
		if (parsedInput.kind === "control") {
			ignoredControlLines += 1;
			continue;
		}
		if (parsedInput.kind === "warning") {
			increment(systemdWarningCounts, parsedInput.warningCode);
			continue;
		}
		if (parsedInput.kind === "error") {
			parseErrors += 1;
			continue;
		}
		const { record } = parsedInput;

		parsedRecords += 1;
		const event = safeLabel(record.event) ?? "unknown";
		const domain = classifyDomain(event);
		const outcome = classifyOutcome(event, record);
		increment(eventCounts, event);
		increment(domainCounts, domain);
		increment(outcomeCounts, outcome);

		if (
			typeof record.statusCode === "number" &&
			Number.isInteger(record.statusCode) &&
			record.statusCode >= 100 &&
			record.statusCode <= 599
		)
			increment(httpStatusCounts, String(record.statusCode));
		addBoundedLabel(errorTypeCounts, record.errorType);
		addBoundedLabel(errorTypeCounts, record.errorCode);

		const traceId = safeLabel(record.traceId) ?? safeLabel(record.requestId);
		if (traceId) traceIds.add(traceId);
		for (const providerRequestId of providerRequestIdLabels(record)) {
			providerRequestIds.add(providerRequestId);
		}

		// traceId 优先、requestId 兜底；没有关联标识的日志仍进入普通计数，
		// 但业务证据门禁不会把它和另一条链上的成功事件拼成一次完成。
		if (traceId) {
			correlationRecordCount += 1;
			const fingerprint = correlationFingerprint(traceId);
			let events = correlationChains.get(fingerprint);
			if (!events) {
				if (correlationChains.size >= MAX_CORRELATION_CHAINS) {
					correlationTruncated = true;
					continue;
				}
				events = {
					events: new Map(),
					httpCompletedStatusCounts: new Map(),
				};
				correlationChains.set(fingerprint, events);
			}
			increment(events.events, event);
			// 只有最终 HTTP 完成事件的 2xx 状态才算“成功结果已返回”。
			// 业务 service 的 success 日志不能单独替代响应层事实；4xx/5xx
			// 即使与 success 共用一条链，也必须由业务门禁拒绝。
			if (
				event === "http.request.completed" &&
				typeof record.statusCode === "number" &&
				Number.isInteger(record.statusCode) &&
				record.statusCode >= 100 &&
				record.statusCode <= 599
			)
				increment(events.httpCompletedStatusCounts, String(record.statusCode));
		} else {
			correlationMissingCount += 1;
		}
	}

	return {
		inputLines,
		parsedRecords,
		parseErrors,
		ignoredBlankLines,
		ignoredControlLines,
		strippedBomLines,
		eventCounts: sortedCounts(eventCounts),
		domainCounts: sortedCounts(domainCounts),
		outcomeCounts: sortedCounts(outcomeCounts),
		httpStatusCounts: sortedCounts(httpStatusCounts),
		errorTypeCounts: sortedCounts(errorTypeCounts),
		systemdWarningCounts: sortedCounts(systemdWarningCounts),
		systemdWarningCount: [...systemdWarningCounts.values()].reduce(
			(total, count) => total + count,
			0,
		),
		traceIdCount: traceIds.size,
		providerRequestIdCount: providerRequestIds.size,
		correlation: {
			chainCount: correlationChains.size,
			recordCount: correlationRecordCount,
			missingCount: correlationMissingCount,
			truncated: correlationTruncated,
			chains: sortedCorrelationChains(correlationChains),
		},
	};
}

async function readInput() {
	const fileIndex = process.argv.indexOf("--file");
	if (fileIndex >= 0) {
		const filePath = process.argv[fileIndex + 1];
		if (!filePath) throw new Error("--file 需要一个日志文件路径");
		return (await readFile(filePath, "utf8")).split(/\r?\n/u);
	}

	let input = "";
	for await (const chunk of process.stdin) input += chunk;
	return input.split(/\r?\n/u);
}

async function main() {
	const summary = aggregateLines(await readInput());
	if (process.argv.includes("--json")) {
		// 机器串联时输出纯 JSON，避免下游证据门禁把人类提示行误判成
		// parseErrors；默认的人类提示仍保留，方便直接在受控终端查看。
		console.log(JSON.stringify(summary));
		return;
	}
	console.log("P0 日志聚合完成（只输出安全计数，不包含原始日志内容）：");
	console.log(JSON.stringify(summary, null, 2));
}

if (import.meta.main) await main();
