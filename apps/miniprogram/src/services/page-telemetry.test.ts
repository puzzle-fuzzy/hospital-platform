import { afterEach, beforeEach, expect, test } from "bun:test";
import {
	installClientPageTelemetry,
	resetClientPageTelemetryForTests,
} from "./page-telemetry";
import {
	clearClientTelemetryEvents,
	getRecentClientTelemetryEvents,
	setClientTelemetryEnvVersionForTests,
} from "./telemetry";

type GlobalPageHolder = {
	Page?: unknown;
	__hospitalPageTelemetryInstalled?: boolean;
};

type WxNavigationHolder = Record<string, unknown>;

type PageConfig = {
	route?: string;
	onLoad?: (...args: unknown[]) => unknown;
	onShow?: () => unknown;
	onDoctorTapped?: (event: unknown) => unknown;
	onBroken?: () => unknown;
	onRefresh?: () => Promise<unknown>;
	onTabItemTap?: (event?: unknown) => unknown;
};

let registeredConfig: PageConfig | undefined;
let originalPage: unknown;

function installFakePageConstructor(): void {
	const holder = globalThis as unknown as GlobalPageHolder;
	originalPage = holder.Page;
	registeredConfig = undefined;
	holder.Page = (config: PageConfig): void => {
		registeredConfig = config;
	};
}

function restoreFakePageConstructor(): void {
	const holder = globalThis as unknown as GlobalPageHolder;
	resetClientPageTelemetryForTests(originalPage);
	holder.Page = originalPage;
}

beforeEach(() => {
	clearClientTelemetryEvents();
	setClientTelemetryEnvVersionForTests("develop");
	installFakePageConstructor();
});

afterEach(() => {
	restoreFakePageConstructor();
	delete (globalThis as unknown as WxNavigationHolder).wx;
	setClientTelemetryEnvVersionForTests(null);
	clearClientTelemetryEvents();
});

function pageActions() {
	return getRecentClientTelemetryEvents().filter(
		(event) => event.kind === "page.action",
	);
}

test("Page 包装后生命周期与用户点击都进入事件流", () => {
	installClientPageTelemetry();
	const holder = globalThis as unknown as GlobalPageHolder;
	(holder.Page as (config: unknown) => void)({
		onShow() {
			return "shown";
		},
		onDoctorTapped(event: unknown) {
			return event;
		},
	});

	const instance = { route: "pages/appointment-schedule/appointment-schedule" };
	const showResult = registeredConfig?.onShow?.apply(instance);
	expect(showResult).toBe("shown");

	const tapEvent = {
		type: "tap",
		detail: {},
		currentTarget: { dataset: { doctorName: "李四" } },
	};
	const tapResult = registeredConfig?.onDoctorTapped?.call(instance, tapEvent);
	expect(tapResult).toBe(tapEvent);

	const events = getRecentClientTelemetryEvents();
	expect(events[0]?.kind).toBe("page.lifecycle");
	expect(events[0]?.method).toBe("onShow");
	expect(events[0]?.route).toBe(
		"pages/appointment-schedule/appointment-schedule",
	);
	const action = pageActions()[0];
	expect(action?.method).toBe("onDoctorTapped");
	expect(action?.eventType).toBe("tap");
	expect(
		(action?.dataset as Record<string, unknown> | undefined)?.doctorName,
	).toBe("李四");
});

test("包装保持 this、参数、同步返回值和异常语义不变", () => {
	installClientPageTelemetry();
	const holder = globalThis as unknown as GlobalPageHolder;
	const calls: Array<{ thisValue: unknown; args: unknown[] }> = [];
	(holder.Page as (config: unknown) => void)({
		onLoad(query: unknown) {
			calls.push({ thisValue: this, args: [query] });
			return 42;
		},
		onBroken() {
			calls.push({ thisValue: this, args: [] });
			throw new Error("boom");
		},
	});

	const instance = { route: "pages/index/index", marker: "page-instance" };
	const result = registeredConfig?.onLoad?.call(instance, { id: "q1" });
	expect(result).toBe(42);
	expect(calls[0]?.thisValue).toBe(instance);
	expect(calls[0]?.args).toEqual([{ id: "q1" }]);

	expect(() => registeredConfig?.onBroken?.call(instance)).toThrow("boom");
	const failures = getRecentClientTelemetryEvents().filter(
		(event) => event.outcome === "failed",
	);
	expect(failures).toHaveLength(1);
	expect(failures[0]?.errorName).toBe("Error");
	expect(failures[0]?.route).toBe("pages/index/index");
});

test("异步方法的拒绝只旁路记录，原始 Promise 语义不变", async () => {
	installClientPageTelemetry();
	const holder = globalThis as unknown as GlobalPageHolder;
	(holder.Page as (config: unknown) => void)({
		onRefresh: () => Promise.reject(new TypeError("network down")),
	});
	const instance = { route: "pages/my/my" };

	const rejection = (
		registeredConfig?.onRefresh as () => Promise<unknown>
	)?.call(instance);
	await expect(rejection).rejects.toThrow("network down");
	// 旁路 catch 可能晚一个微任务执行。
	await Promise.resolve();

	const failures = getRecentClientTelemetryEvents().filter(
		(event) => event.outcome === "failed",
	);
	expect(failures).toHaveLength(1);
	expect(failures[0]?.kind).toBe("page.action");
	expect(failures[0]?.errorName).toBe("TypeError");
});

test("重复安装不会二次包装页面方法", () => {
	installClientPageTelemetry();
	installClientPageTelemetry();
	const holder = globalThis as unknown as GlobalPageHolder;
	(holder.Page as (config: unknown) => void)({
		onTabItemTap() {
			return undefined;
		},
	});
	registeredConfig?.onTabItemTap?.call({ route: "pages/index/index" });
	registeredConfig?.onTabItemTap?.call({ route: "pages/index/index" });

	// onTabItemTap 是用户手势，按 page.action 记录，且每次点击一条。
	const actions = pageActions();
	expect(actions).toHaveLength(2);
	expect(actions[0]?.method).toBe("onTabItemTap");
	expect(actions[0]?.route).toBe("pages/index/index");
});

test("导航 API 包装记录目标路径、剥离查询串并保留返回值", () => {
	const captured: Array<{ options: unknown }> = [];
	const wxStub: WxNavigationHolder = {
		navigateTo(options: unknown) {
			captured.push({ options });
			return "navigate-returned";
		},
		switchToBeIgnored: true,
	};
	(globalThis as unknown as { wx?: unknown }).wx = wxStub;
	installClientPageTelemetry();

	let failSeen: unknown;
	const options = {
		url: "/pages/report-directory/report-directory?patientId=p1&from=tap",
		fail: (error: unknown) => {
			failSeen = error;
		},
	};
	const returned = (wxStub.navigateTo as (options: unknown) => unknown)(
		options,
	);
	expect(returned).toBe("navigate-returned");

	const navigationEvents = getRecentClientTelemetryEvents().filter(
		(event) => event.kind === "navigation",
	);
	expect(navigationEvents).toHaveLength(1);
	expect(navigationEvents[0]?.action).toBe("navigateTo");
	expect(navigationEvents[0]?.target).toBe(
		"/pages/report-directory/report-directory",
	);

	// fail 回调被包装：先记录失败事实，再执行页面原始回调。
	const enhanced = captured[0]?.options as { fail?: (error: unknown) => void };
	const navigationError = { errMsg: "navigateTo:fail page not found" };
	enhanced.fail?.(navigationError);
	expect(failSeen).toBe(navigationError);
	const failedNavigation = getRecentClientTelemetryEvents().filter(
		(event) => event.kind === "navigation" && event.outcome === "failed",
	);
	expect(failedNavigation).toHaveLength(1);
	expect(failedNavigation[0]?.errorName).toBe("navigateTo");
});
