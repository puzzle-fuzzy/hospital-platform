import { describe, expect, test } from "bun:test";
import { ApiError } from "./api-client";
import {
	sessionVerificationStateFromError,
	sessionVerificationStateFromLabel,
} from "./session-service";

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

describe("首页会话文案门禁", () => {
	test("恢复中不能打开业务入口", () => {
		expect(sessionVerificationStateFromLabel("验证会话中")).toBe("checking");
	});

	test("恢复成功和主动登录成功都允许打开业务入口", () => {
		expect(sessionVerificationStateFromLabel("已恢复会话")).toBe("valid");
		expect(sessionVerificationStateFromLabel("已登录")).toBe("valid");
	});

	test("未登录和依赖暂不可用必须保持不同的失败语义", () => {
		expect(sessionVerificationStateFromLabel("未登录")).toBe("invalid");
		expect(sessionVerificationStateFromLabel("会话暂不可用")).toBe(
			"unavailable",
		);
	});
});
