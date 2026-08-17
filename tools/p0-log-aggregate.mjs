import { readFile } from "node:fs/promises";

const SAFE_LABEL_PATTERN = /^[A-Za-z0-9_.:-]{1,96}$/u;
const MAX_DISTINCT_LABELS = 200;

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

/** 对一组 journald JSONL 行生成不含原始业务内容的聚合摘要。 */
export function aggregateLines(lines) {
	const eventCounts = new Map();
	const domainCounts = new Map();
	const outcomeCounts = new Map();
	const httpStatusCounts = new Map();
	const errorTypeCounts = new Map();
	const traceIds = new Set();
	const providerRequestIds = new Set();
	let inputLines = 0;
	let parsedRecords = 0;
	let parseErrors = 0;
	let ignoredBlankLines = 0;
	let ignoredControlLines = 0;
	let strippedBomLines = 0;

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
		let record;
		try {
			record = JSON.parse(line);
		} catch {
			if (isExpectedJournalControlLine(line.trim())) ignoredControlLines += 1;
			else parseErrors += 1;
			continue;
		}
		if (!record || typeof record !== "object" || Array.isArray(record)) {
			parseErrors += 1;
			continue;
		}

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
		const providerRequestId = safeLabel(record.providerRequestId);
		if (providerRequestId) providerRequestIds.add(providerRequestId);
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
		traceIdCount: traceIds.size,
		providerRequestIdCount: providerRequestIds.size,
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
