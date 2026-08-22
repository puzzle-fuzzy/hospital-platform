import { expect, test } from "bun:test";
import {
	aggregateLines,
	classifyDomain,
	classifyOutcome,
} from "./p0-log-aggregate.mjs";

test("P0 日志聚合按业务域和结果分类，并且不输出原始敏感字段", () => {
	const summary = aggregateLines([
		`\uFEFF${JSON.stringify({
			event: "auth.wechat.login.succeeded",
			traceId: "trace-auth",
			openid: "must-not-be-output",
			msg: "must-not-be-output",
		})}`,
		JSON.stringify({
			event: "patient.directory.failed",
			errorType: "ProviderUnavailableError",
			requestId: "trace-patient",
		}),
		JSON.stringify({
			event: "http.request.completed",
			statusCode: 401,
		}),
		"Stopping Hospital Platform API v2 (Bun + Elysia)...",
		"not-json",
	]);

	expect(summary.parsedRecords).toBe(3);
	expect(summary.parseErrors).toBe(1);
	expect(summary.ignoredControlLines).toBe(1);
	expect(summary.strippedBomLines).toBe(1);
	expect(summary.domainCounts.auth).toBe(1);
	expect(summary.domainCounts.patient).toBe(1);
	expect(summary.domainCounts.infrastructure).toBe(1);
	expect(summary.outcomeCounts.success).toBe(1);
	expect(summary.outcomeCounts.failure).toBe(2);
	expect(summary.errorTypeCounts.ProviderUnavailableError).toBe(1);
	expect(summary.traceIdCount).toBe(2);
	expect(summary.eventCounts["auth.wechat.login.succeeded"]).toBe(1);
	expect(summary.correlation).toMatchObject({
		chainCount: 2,
		recordCount: 2,
		missingCount: 1,
		truncated: false,
	});
	const authChain = Object.values(summary.correlation.chains).find(
		(chain) => chain.events["auth.wechat.login.succeeded"] === 1,
	);
	expect(authChain).toEqual({
		events: { "auth.wechat.login.succeeded": 1 },
		httpCompletedStatusCounts: {},
	});

	const output = JSON.stringify(summary);
	expect(output).not.toContain("must-not-be-output");
	expect(output).not.toContain("trace-auth");
});

test("并发冲突和支付域保持独立分类", () => {
	expect(classifyDomain("payment.wechat_prepay.requested")).toBe(
		"payment-frozen",
	);
	expect(classifyOutcome("patient.directory.operation.in_progress", {})).toBe(
		"conflict",
	);
	expect(classifyOutcome("http.request.completed", { statusCode: 503 })).toBe(
		"failure",
	);
});

test("聚合器统计有界多请求 provider trace 并去重", () => {
	const summary = aggregateLines([
		JSON.stringify({
			event: "patient.directory.snapshot.committed",
			providerRequestId: "provider-primary",
			providerRequestIds: [
				"provider-primary",
				"provider-archive-001",
				"provider-archive-002",
			],
		}),
		JSON.stringify({
			event: "patient.directory.synced",
			providerRequestId: "provider-primary",
			providerRequestIds: [
				"provider-primary",
				"provider-archive-001",
				"provider-archive-002",
			],
		}),
	]);

	// 两条成功日志共享同一组请求号，摘要应去重后得到 3，而不是只得到主 ID 的 1。
	expect(summary.providerRequestIdCount).toBe(3);
});

test("支持 journald -o json 的 MESSAGE envelope，并忽略已知 systemd 控制消息", () => {
	const summary = aggregateLines([
		JSON.stringify({
			_SYSTEMD_UNIT: "hospital-platform-api-v2.service",
			MESSAGE: JSON.stringify({
				event: "auth.wechat.login.succeeded",
				traceId: "trace-auth-json-envelope",
			}),
		}),
		JSON.stringify({
			_SYSTEMD_UNIT: "hospital-platform-api-v2.service",
			MESSAGE: "Stopping Hospital Platform API v2 (Bun + Elysia)...",
		}),
		JSON.stringify({
			_SYSTEMD_UNIT: "hospital-platform-api-v2.service",
			MESSAGE: "systemd 未知文本不应被静默吞掉",
		}),
	]);

	expect(summary.parsedRecords).toBe(1);
	expect(summary.parseErrors).toBe(1);
	expect(summary.ignoredControlLines).toBe(1);
	expect(summary.eventCounts["auth.wechat.login.succeeded"]).toBe(1);
	expect(summary.traceIdCount).toBe(1);
	expect(summary.correlation.chainCount).toBe(1);
	expect(summary.correlation.missingCount).toBe(0);
});

test("关联链只保留 HTTP 完成状态码，不输出原始链路标识", () => {
	const summary = aggregateLines([
		JSON.stringify({
			event: "appointment.records.requested",
			traceId: "trace-http-success",
		}),
		JSON.stringify({
			event: "appointment.records.synced",
			traceId: "trace-http-success",
		}),
		JSON.stringify({
			event: "http.request.completed",
			traceId: "trace-http-success",
			statusCode: 200,
		}),
	]);

	const chain = Object.values(summary.correlation.chains)[0];
	expect(chain).toEqual({
		events: {
			"appointment.records.requested": 1,
			"appointment.records.synced": 1,
			"http.request.completed": 1,
		},
		httpCompletedStatusCounts: { 200: 1 },
	});
	expect(JSON.stringify(summary)).not.toContain("trace-http-success");
});

test("患者和费用日志聚合不会输出患者标识、卡号或金额", () => {
	const summary = aggregateLines([
		JSON.stringify({
			event: "outpatient.payment.records.requested",
			traceId: "sensitive-trace-001",
			patientId: "platform-patient-001",
			providerPatientId: "his-patient-001",
			cardNo: "001000305367027",
			amountFen: 12800,
		}),
		JSON.stringify({
			event: "outpatient.payment.records.loaded",
			traceId: "sensitive-trace-001",
			patientId: "platform-patient-001",
			providerRequestId: "provider-request-001",
		}),
		JSON.stringify({
			event: "http.request.completed",
			traceId: "sensitive-trace-001",
			statusCode: 200,
		}),
	]);

	// 聚合摘要只用于判断事件链是否完整；即使原始日志中存在排障字段，
	// 也不能把患者、Provider、卡号或金额复制到交接文件和验收工具输出。
	const serialized = JSON.stringify(summary);
	expect(serialized).not.toContain("platform-patient-001");
	expect(serialized).not.toContain("his-patient-001");
	expect(serialized).not.toContain("001000305367027");
	expect(serialized).not.toContain("12800");
	expect(serialized).not.toContain("sensitive-trace-001");
	expect(summary.eventCounts["outpatient.payment.records.loaded"]).toBe(1);
});

test("systemd 停止超时只记录稳定 warning，不把 PID 和进程名带入聚合", () => {
	const summary = aggregateLines([
		JSON.stringify({
			MESSAGE:
				"hospital-platform-api-v2.service: State 'stop-sigterm' timed out. Killing.",
		}),
		JSON.stringify({
			MESSAGE:
				"hospital-platform-api-v2.service: Killing process 12345 (bun) with signal SIGKILL.",
		}),
		JSON.stringify({
			MESSAGE:
				"hospital-platform-api-v2.service: Main process exited, code=killed, status=9/KILL",
		}),
		JSON.stringify({
			MESSAGE:
				"hospital-platform-api-v2.service: Failed with result 'timeout'.",
		}),
	]);

	expect(summary.parseErrors).toBe(0);
	expect(summary.systemdWarningCount).toBe(4);
	expect(summary.systemdWarningCounts).toEqual({
		"main-process-killed": 1,
		"process-killed": 1,
		"service-stop-timeout": 1,
		"service-timeout-failed": 1,
	});
	expect(JSON.stringify(summary)).not.toContain("12345");
	expect(JSON.stringify(summary)).not.toContain("bun");
});
