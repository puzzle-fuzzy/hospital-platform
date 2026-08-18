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
