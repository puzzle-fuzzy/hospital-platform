import { describe, expect, test } from "bun:test";
import { resolvePatientScopedEntry } from "./patient-navigation";

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
