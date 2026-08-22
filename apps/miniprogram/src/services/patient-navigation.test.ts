import { describe, expect, test } from "bun:test";
import {
	hasCurrentPatientContext,
	resolveAuthenticatedEntry,
	resolvePatientScopedEntry,
} from "./patient-navigation";

const readyPatient = { id: "patient-a", clinicalAccess: "ready" as const };
const unavailablePatient = {
	id: "patient-a",
	clinicalAccess: "unavailable" as const,
};

describe("会话验证入口门禁", () => {
	test("只有服务端验证成功才允许打开页面", () => {
		expect(resolveAuthenticatedEntry("valid")).toBe("open");
	});

	test("验证中和暂不可用时必须等待，不能把故障当作退出登录", () => {
		expect(resolveAuthenticatedEntry("checking")).toBe("wait-for-session");
		expect(resolveAuthenticatedEntry("unavailable")).toBe("wait-for-session");
	});

	test("服务端明确拒绝会话时才回首页重新登录", () => {
		expect(resolveAuthenticatedEntry("invalid")).toBe("redirect-to-login");
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

	test("入口只接受临床可用且与显式选择一致的患者", () => {
		expect(hasCurrentPatientContext(readyPatient, "patient-a")).toBe(true);
		expect(hasCurrentPatientContext(unavailablePatient, "patient-a")).toBe(
			false,
		);
		expect(hasCurrentPatientContext(readyPatient, "patient-b")).toBe(false);
		expect(hasCurrentPatientContext(null, "patient-a")).toBe(false);
	});
});
