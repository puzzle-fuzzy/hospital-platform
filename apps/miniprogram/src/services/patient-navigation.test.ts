import { describe, expect, test } from "bun:test";
import {
	hasCurrentPatientContext,
	navigateToAuthenticatedPage,
	navigateToMissedAppointmentsPage,
	navigateToPatientSelector,
	resolveAuthenticatedEntry,
	resolvePatientScopedEntry,
	switchToPrimaryTab,
} from "./patient-navigation";
import { runPatientSync } from "./patient-sync-coordinator";

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

describe("微信原生 Tab 路由边界", () => {
	test("主 Tab 只使用 switchTab，普通业务页不被误判", () => {
		const runtime = globalThis as typeof globalThis & { wx?: typeof wx };
		const originalWx = runtime.wx;
		const switchedUrls: string[] = [];
		runtime.wx = {
			switchTab: ({ url }: { url: string }) => {
				switchedUrls.push(url);
			},
		} as unknown as typeof wx;

		try {
			expect(switchToPrimaryTab("/pages/my/my")).toBe(true);
			expect(
				switchToPrimaryTab("/pages/appointment-records/appointment-records"),
			).toBe(false);
			expect(switchedUrls).toEqual(["/pages/my/my"]);
		} finally {
			if (originalWx) {
				runtime.wx = originalWx;
			} else {
				delete runtime.wx;
			}
		}
	});

	test("当前主 Tab 不重复 switchTab，避免重复生命周期造成闪动", () => {
		const runtime = globalThis as typeof globalThis & {
			wx?: typeof wx;
			getCurrentPages?: () => Array<{ route?: string }>;
		};
		const originalWx = runtime.wx;
		const originalGetCurrentPages = runtime.getCurrentPages;
		const switchedUrls: string[] = [];
		runtime.wx = {
			switchTab: ({ url }: { url: string }) => {
				switchedUrls.push(url);
			},
		} as unknown as typeof wx;
		runtime.getCurrentPages = () => [{ route: "pages/my/my" }];

		try {
			expect(switchToPrimaryTab("/pages/my/my")).toBe(true);
			expect(switchedUrls).toEqual([]);
		} finally {
			if (originalWx) {
				runtime.wx = originalWx;
			} else {
				delete runtime.wx;
			}
			if (originalGetCurrentPages) {
				runtime.getCurrentPages = originalGetCurrentPages;
			} else {
				delete runtime.getCurrentPages;
			}
		}
	});

	test("会话失效回首页也必须复用共享 TabBar", () => {
		const runtime = globalThis as typeof globalThis & { wx?: typeof wx };
		const originalWx = runtime.wx;
		const switchedUrls: string[] = [];
		runtime.wx = {
			showToast: () => undefined,
			switchTab: ({ url }: { url: string }) => {
				switchedUrls.push(url);
			},
			reLaunch: () => {
				throw new Error("primary tab must not use reLaunch");
			},
		} as unknown as typeof wx;

		try {
			expect(
				navigateToAuthenticatedPage("/pages/profile/profile", "invalid"),
			).toBe("redirected-to-login");
			expect(switchedUrls).toEqual(["/pages/index/index"]);
		} finally {
			if (originalWx) {
				runtime.wx = originalWx;
			} else {
				delete runtime.wx;
			}
		}
	});
});

describe("患者范围页面入口门禁", () => {
	test("爽约入口不因缺少患者而转入患者选择页", () => {
		const runtime = globalThis as typeof globalThis & { wx?: typeof wx };
		const originalWx = runtime.wx;
		const navigateUrls: string[] = [];
		runtime.wx = {
			showToast: () => undefined,
			navigateTo: ({ url }: { url: string }) => {
				navigateUrls.push(url);
			},
			reLaunch: () => undefined,
		} as unknown as typeof wx;

		try {
			expect(navigateToMissedAppointmentsPage("valid")).toBe("navigated");
			expect(navigateUrls).toEqual([
				"/pages/missed-appointments/missed-appointments",
			]);
		} finally {
			if (originalWx) {
				runtime.wx = originalWx;
			} else {
				delete runtime.wx;
			}
		}
	});

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

	test("患者同步进行中时选择页入口返回明确结果，调用方不能永久 loading", async () => {
		const runtime = globalThis as typeof globalThis & { wx?: typeof wx };
		const originalWx = runtime.wx;
		let navigateCalls = 0;
		let resolvePending: ((value: []) => void) | undefined;
		runtime.wx = {
			showToast: () => undefined,
			navigateTo: () => {
				navigateCalls += 1;
			},
			reLaunch: () => undefined,
		} as unknown as typeof wx;

		try {
			const pending = runPatientSync(
				() =>
					new Promise<[]>((resolve) => {
						resolvePending = resolve;
					}),
			);
			expect(navigateToPatientSelector("valid")).toBe("sync-in-flight");
			expect(navigateCalls).toBe(0);
			// single-flight 会在微任务中启动 factory；先让测试 Promise 建立完成，
			// 再释放它，避免测试本身因过早 resolve 而永久等待。
			await Promise.resolve();
			resolvePending?.([]);
			await pending;
			await Promise.resolve();
			expect(navigateToPatientSelector("valid")).toBe("navigated");
			expect(navigateCalls).toBe(1);
		} finally {
			if (originalWx) {
				runtime.wx = originalWx;
			} else {
				delete runtime.wx;
			}
		}
	});
});
