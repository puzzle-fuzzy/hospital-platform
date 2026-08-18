import { describe, expect, test } from "bun:test";
import {
	resolveAuthenticatedEntry,
	resolvePatientScopedEntry,
} from "./patient-navigation";

describe("会话验证入口门禁", () => {
	test("验证成功或兼容布尔 true 才允许打开页面", () => {
		expect(resolveAuthenticatedEntry("valid")).toBe("open");
		expect(resolveAuthenticatedEntry(true)).toBe("open");
	});

	test("验证中和暂不可用时必须等待，不能把故障当作退出登录", () => {
		expect(resolveAuthenticatedEntry("checking")).toBe("wait-for-session");
		expect(resolveAuthenticatedEntry("unavailable")).toBe("wait-for-session");
	});

	test("服务端明确拒绝会话时才回首页重新登录", () => {
		expect(resolveAuthenticatedEntry("invalid")).toBe("redirect-to-login");
		expect(resolveAuthenticatedEntry(false)).toBe("redirect-to-login");
	});
});

describe("患者范围页面入口门禁", () => {
	test("未登录时必须回首页建立平台会话", () => {
		expect(resolvePatientScopedEntry(false, false)).toBe("redirect-to-login");
		expect(resolvePatientScopedEntry(false, true)).toBe("redirect-to-login");
	});

	test("已登录但没有当前就诊人时必须进入选择页", () => {
		expect(resolvePatientScopedEntry(true, false)).toBe("select-patient");
	});

	test("已登录且有当前就诊人时才允许打开业务页", () => {
		expect(resolvePatientScopedEntry(true, true)).toBe("open");
	});
});
