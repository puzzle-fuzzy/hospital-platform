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

	const output = JSON.stringify(summary);
	expect(output).not.toContain("must-not-be-output");
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
