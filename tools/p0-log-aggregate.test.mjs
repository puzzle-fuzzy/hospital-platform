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
