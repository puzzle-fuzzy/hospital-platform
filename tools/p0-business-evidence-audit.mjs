import { readFile } from "node:fs/promises";

/**
 * P0 业务证据门禁只消费 p0-log-aggregate 生成的安全计数，不读取或输出原始日志。
 *
 * `requested` 证明请求已经进入业务模块，`success` 证明至少有一次明确的业务成功
 * 事实；二者必须和最终 `http.request.completed` 的 2xx 状态出现在同一条
 * traceId/requestId 关联链中。这样不同请求的总数不会被拼成一次成功，也不会把
 * service 层已经写出的 success 事件误当成客户端已经收到成功响应。`failure` 只
 * 作为风险提示保留，不会被工具降级成成功。关联摘要只保留 SHA-256 指纹、事件
 * 计数和 HTTP 完成状态计数，不输出原始链路标识；跨三层验收仍需人工核对页面和
 * HTTP 语义。
 */

const BUSINESS_EVIDENCE_CONTRACTS = Object.freeze({
	auth: {
		label: "微信登录",
		requested: ["auth.wechat.login.requested"],
		success: ["auth.wechat.login.succeeded"],
		failure: ["auth.wechat.login.failed"],
	},
	patientRead: {
		label: "患者目录读取",
		requested: ["patient.directory.read.requested"],
		success: ["patient.directory.read.loaded"],
		failure: ["patient.directory.read.failed"],
	},
	patientSync: {
		label: "患者目录同步",
		requested: ["patient.directory.requested"],
		// 同一幂等操作的成功重放不应再次访问 Provider，但仍是已持久化的
		// 患者目录事实；因此 replay 与首次 synced 都属于成功证据。
		success: [
			"patient.directory.synced",
			"patient.directory.operation.replayed",
		],
		failure: ["patient.directory.failed"],
	},
	appointmentRecords: {
		label: "预约历史",
		requested: ["appointment.records.requested"],
		success: ["appointment.records.synced"],
		failure: ["appointment.records.failed"],
	},
	// 科室和排班是两个连续但独立的只读请求；必须分别验收，不能因为
	// 科室成功、排班失败就把级联预约目录整体误判为成功。
	appointmentDepartments: {
		label: "预约科室目录",
		requested: ["appointment.directory.departments.requested"],
		success: ["appointment.directory.departments.synced"],
		failure: ["appointment.directory.departments.failed"],
	},
	appointmentSchedules: {
		label: "预约排班目录",
		requested: ["appointment.directory.schedules.requested"],
		success: ["appointment.directory.schedules.synced"],
		failure: ["appointment.directory.schedules.failed"],
	},
	outpatientPaymentRecords: {
		label: "门诊费用只读",
		requested: ["outpatient.payment.records.requested"],
		success: ["outpatient.payment.records.loaded"],
		failure: ["outpatient.payment.records.failed"],
	},
	reportDirectory: {
		label: "报告目录",
		requested: ["report.directory.requested"],
		success: ["report.directory.synced"],
		failure: ["report.directory.failed"],
	},
	profileRead: {
		label: "普通资料读取",
		requested: ["user.profile.requested"],
		success: ["user.profile.loaded"],
		failure: ["user.profile.read_failed"],
	},
	profileUpdate: {
		label: "普通资料更新",
		// requested 只证明请求进入更新 service；updated 是成功写入，conflict
		// 是明确的 409 并发结果，二者都不能互相冒充。
		requested: ["user.profile.update.requested"],
		success: ["user.profile.updated"],
		failure: ["user.profile.update_failed", "user.profile.conflict"],
	},
});

function countEvents(eventCounts, events) {
	return events.reduce((total, event) => {
		const count = eventCounts[event];
		return total + (Number.isSafeInteger(count) && count > 0 ? count : 0);
	}, 0);
}

/** 只在同一条安全关联链内寻找请求和成功事件，拒绝跨请求拼接。 */
function countCorrelatedChains(correlation, contract) {
	let correlatedChainCount = 0;
	for (const chain of Object.values(correlation.chains)) {
		if (!chain || typeof chain !== "object" || Array.isArray(chain)) continue;
		const events = chain.events;
		if (!events || typeof events !== "object" || Array.isArray(events))
			continue;
		const requestedCount = countEvents(events, contract.requested);
		const successCount = countEvents(events, contract.success);
		if (requestedCount > 0 && successCount > 0) correlatedChainCount += 1;
	}
	return correlatedChainCount;
}

/**
 * 只接受同一业务关联链上的 HTTP 2xx 完成事实。
 *
 * `httpStatusCounts` 的全局总数没有关联意义；必须读取当前 chain 的
 * `httpCompletedStatusCounts`。如果链上同时出现 `http.request.failed`，即使
 * 曾出现 2xx 也视为结果不明确，避免异常重试或响应层错误被成功计数掩盖。
 */
function countCorrelatedHttpSuccessChains(correlation, contract) {
	let httpSuccessChainCount = 0;
	for (const chain of Object.values(correlation.chains)) {
		if (!chain || typeof chain !== "object" || Array.isArray(chain)) continue;
		const events = chain.events;
		const completedStatusCounts = chain.httpCompletedStatusCounts;
		if (
			!events ||
			typeof events !== "object" ||
			Array.isArray(events) ||
			!completedStatusCounts ||
			typeof completedStatusCounts !== "object" ||
			Array.isArray(completedStatusCounts)
		)
			continue;
		const requestedCount = countEvents(events, contract.requested);
		const successCount = countEvents(events, contract.success);
		const hasHttpFailure = countEvents(events, ["http.request.failed"]) > 0;
		const hasHttp2xx = Object.entries(completedStatusCounts).some(
			([statusCode, count]) => {
				const numericStatusCode = Number(statusCode);
				return (
					Number.isInteger(numericStatusCode) &&
					numericStatusCode >= 200 &&
					numericStatusCode <= 299 &&
					Number.isSafeInteger(count) &&
					count > 0
				);
			},
		);
		if (requestedCount > 0 && successCount > 0 && hasHttp2xx && !hasHttpFailure)
			httpSuccessChainCount += 1;
	}
	return httpSuccessChainCount;
}

function validateSummary(summary) {
	if (!summary || typeof summary !== "object" || Array.isArray(summary)) {
		throw new Error("输入不是安全的日志聚合对象");
	}
	if (
		!summary.eventCounts ||
		typeof summary.eventCounts !== "object" ||
		Array.isArray(summary.eventCounts)
	) {
		throw new Error("日志聚合对象缺少 eventCounts");
	}
	if (!Number.isSafeInteger(summary.parseErrors) || summary.parseErrors < 0) {
		throw new Error("日志聚合对象缺少有效的 parseErrors");
	}
	if (
		summary.systemdWarningCount !== undefined &&
		(!Number.isSafeInteger(summary.systemdWarningCount) ||
			summary.systemdWarningCount < 0)
	) {
		throw new Error("日志聚合对象缺少有效的 systemdWarningCount");
	}
	const correlation = summary.correlation;
	if (
		!correlation ||
		typeof correlation !== "object" ||
		Array.isArray(correlation) ||
		!correlation.chains ||
		typeof correlation.chains !== "object" ||
		Array.isArray(correlation.chains) ||
		!Number.isSafeInteger(correlation.chainCount) ||
		correlation.chainCount < 0 ||
		correlation.chainCount !== Object.keys(correlation.chains).length ||
		!Number.isSafeInteger(correlation.missingCount) ||
		correlation.missingCount < 0 ||
		typeof correlation.truncated !== "boolean"
	) {
		throw new Error("日志聚合对象缺少有效的关联链摘要");
	}
}

/**
 * 对一个安全聚合摘要执行指定业务域的证据门禁。
 *
 * 返回值只包含业务域名称、事件计数、缺失项和解析错误数量，不复制 trace、
 * requestId、患者标识、金额或 Provider 原文；调用方可以据此生成验收记录，
 * 但不能据此跳过页面与 HTTP 结果核对。
 */
export function auditBusinessEvidence(
	summary,
	domains = Object.keys(BUSINESS_EVIDENCE_CONTRACTS),
) {
	validateSummary(summary);
	if (!Array.isArray(domains) || domains.length === 0) {
		throw new Error("至少指定一个业务域");
	}

	const results = {};
	const systemdWarningCount = summary.systemdWarningCount ?? 0;
	for (const domain of domains) {
		const contract = BUSINESS_EVIDENCE_CONTRACTS[domain];
		if (!contract) throw new Error(`未知的 P0 业务域: ${domain}`);

		const requestedCount = countEvents(summary.eventCounts, contract.requested);
		const successCount = countEvents(summary.eventCounts, contract.success);
		const failureCount = countEvents(summary.eventCounts, contract.failure);
		const correlatedChainCount = countCorrelatedChains(
			summary.correlation,
			contract,
		);
		const httpSuccessChainCount = countCorrelatedHttpSuccessChains(
			summary.correlation,
			contract,
		);
		const missing = [];
		if (requestedCount === 0) missing.push("requested");
		if (successCount === 0) missing.push("success");
		if (correlatedChainCount === 0) missing.push("same-trace-request-success");
		if (httpSuccessChainCount === 0) missing.push("same-trace-http-2xx");
		if (summary.correlation.truncated) missing.push("correlation-truncated");
		results[domain] = {
			label: contract.label,
			requestedCount,
			successCount,
			failureCount,
			correlatedChainCount,
			httpSuccessChainCount,
			missing,
			passed:
				summary.parseErrors === 0 &&
				systemdWarningCount === 0 &&
				missing.length === 0,
		};
	}

	return {
		passed:
			summary.parseErrors === 0 &&
			systemdWarningCount === 0 &&
			Object.values(results).every((result) => result.passed),
		parseErrors: summary.parseErrors,
		systemdWarningCount,
		domains: results,
	};
}

function flagValue(flag) {
	const index = process.argv.indexOf(flag);
	return index >= 0 ? process.argv[index + 1] : undefined;
}

async function readSummary() {
	const file = flagValue("--file");
	if (file) {
		const input = await readFile(file, "utf8");
		return parseSummaryJson(input);
	}
	let input = "";
	for await (const chunk of process.stdin) input += chunk;
	// Windows PowerShell 可能在进程管道开头保留 UTF-8 BOM；它不是
	// 业务日志内容，应该在 JSON 摘要边界剥离，而不是把整次证据判成坏数据。
	return parseSummaryJson(input);
}

/**
 * 解析日志聚合摘要时先区分“没有输入”和“JSON 损坏”。
 *
 * 这个工具只接受 `p0-log-aggregate` 生成的 JSON 摘要；直接空运行时如果
 * 透出 JavaScript 的 `Unexpected EOF`，维护人员很容易误以为生产日志被截断。
 * 这里统一给出中文操作提示，但不输出原始日志或摘要内容，避免诊断工具
 * 反过来扩大敏感信息暴露面。
 */
function parseSummaryJson(input) {
	const normalized = input.replace(/^\uFEFF/u, "").trim();
	if (!normalized) {
		throw new Error(
			"未提供日志聚合摘要；请先运行 p0-log-aggregate，再通过管道传入或使用 --file 指定 JSON 文件",
		);
	}
	try {
		return JSON.parse(normalized);
	} catch {
		throw new Error("日志聚合摘要不是有效 JSON，请重新生成安全聚合结果");
	}
}

async function main() {
	const domain = flagValue("--domain");
	const domains = domain ? [domain] : undefined;
	const result = auditBusinessEvidence(await readSummary(), domains);
	console.log(JSON.stringify(result, null, 2));
	if (!result.passed) process.exitCode = 1;
}

if (import.meta.main) {
	try {
		await main();
	} catch (error) {
		console.error(
			`P0 业务证据审计失败：${error instanceof Error ? error.message : "未知错误"}`,
		);
		process.exitCode = 2;
	}
}
