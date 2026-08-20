import { expect, test } from "bun:test";
import {
	ExternalTraceReadModelValidationError,
	normalizeExternalTrace,
} from "./external-trace";

test("external trace 只投影低敏字段并确认 Provider 范围", () => {
	expect(
		normalizeExternalTrace(
			{
				provider: "zhongyang",
				operation: "appointment-records",
				requestId: "provider-request-001",
				providerOrderId: "provider-order-001",
				openid: "must-not-cross-boundary",
			},
			{ expectedProvider: "zhongyang" },
		),
	).toEqual({
		provider: "zhongyang",
		operation: "appointment-records",
		requestId: "provider-request-001",
		providerOrderId: "provider-order-001",
	});
});

test("external trace 拒绝异常字符串和错误 Provider", () => {
	for (const scenario of [
		{
			value: {
				provider: "zhongyang",
				operation: "records",
				requestId: "bad\n-id",
			},
			violation: "request-id-invalid",
		},
		{
			value: {
				provider: "other",
				operation: "records",
				requestId: "request-001",
			},
			violation: "provider-mismatch",
		},
		{
			value: undefined,
			violation: "trace-not-object",
		},
	] as const) {
		expect(() =>
			normalizeExternalTrace(scenario.value, { expectedProvider: "zhongyang" }),
		).toThrow(new ExternalTraceReadModelValidationError(scenario.violation));
	}
});

test("多 Provider trace 保留有界请求号列表而不拼接超长主 ID", () => {
	const requestIds = ["a".repeat(70), "b".repeat(70), "c".repeat(70)];
	const primaryRequestId = requestIds[0];
	if (!primaryRequestId) throw new Error("test request id is missing");

	expect(
		normalizeExternalTrace(
			{
				provider: "zhongyang",
				operation: "reports-directory",
				requestId: primaryRequestId,
				requestIds,
			},
			{ expectedProvider: "zhongyang" },
		),
	).toEqual({
		provider: "zhongyang",
		operation: "reports-directory",
		requestId: primaryRequestId,
		requestIds,
	});
});

test("多 Provider trace 拒绝不完整或无界请求号列表", () => {
	for (const requestIds of [
		[],
		Array.from({ length: 9 }, (_, index) => `request-${index}`),
		["request-001", "bad\n-request"],
	] as const) {
		expect(() =>
			normalizeExternalTrace(
				{
					provider: "zhongyang",
					operation: "reports-directory",
					requestId: "request-001",
					requestIds,
				},
				{ expectedProvider: "zhongyang" },
			),
		).toThrow(new ExternalTraceReadModelValidationError("request-ids-invalid"));
	}
});
