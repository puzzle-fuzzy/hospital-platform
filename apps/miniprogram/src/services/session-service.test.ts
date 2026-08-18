import { describe, expect, test } from "bun:test";
import { ApiError } from "./api-client";
import { sessionVerificationStateFromError } from "./session-service";

describe("会话验证错误状态", () => {
	test("服务端明确拒绝会话时标记为 invalid", () => {
		expect(
			sessionVerificationStateFromError(
				new ApiError("expired", { code: "unauthorized", statusCode: 401 }),
			),
		).toBe("invalid");
	});

	test("依赖暂时失败时保留 unavailable，不误清理会话", () => {
		expect(
			sessionVerificationStateFromError(
				new ApiError("temporarily unavailable", {
					code: "persistence-temporarily-unavailable",
					statusCode: 503,
				}),
			),
		).toBe("unavailable");
		expect(sessionVerificationStateFromError(new Error("network"))).toBe(
			"unavailable",
		);
	});
});
