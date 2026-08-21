import { describe, expect, test } from "bun:test";
import { ApiError } from "./api-client";
import {
	sessionStateAfterAuthenticatedReadError,
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

describe("已验证会话后的业务读取状态", () => {
	test("患者未选择等业务错误不能覆盖 valid", () => {
		expect(
			sessionStateAfterAuthenticatedReadError(
				new ApiError("patient is required", {
					code: "patient-selection-required",
				}),
				"valid",
				true,
			),
		).toBe("valid");
	});

	test("后续读取再次收到 401 时标记为 invalid", () => {
		expect(
			sessionStateAfterAuthenticatedReadError(
				new ApiError("expired", { code: "unauthorized", statusCode: 401 }),
				"valid",
				false,
			),
		).toBe("invalid");
	});

	test("会话代际变化要求重新验证，而不是继续使用旧页面快照", () => {
		expect(
			sessionStateAfterAuthenticatedReadError(
				new ApiError("changed", { code: "session-changed" }),
				"valid",
				true,
			),
		).toBe("checking");
	});

	test("恢复失败且本地没有 token 时保持暂不可用", () => {
		expect(
			sessionStateAfterAuthenticatedReadError(
				new ApiError("network", { code: "network-failed" }),
				"valid",
				false,
			),
		).toBe("unavailable");
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
