import { afterEach, beforeEach, expect, test } from "bun:test";
import {
	clearClientTelemetryEvents,
	getRecentClientTelemetryEvents,
	isVerboseClientTelemetry,
	logClientErrorTransformed,
	logClientNavigation,
	logClientPageAction,
	logClientPageFailure,
	MAX_RECENT_CLIENT_TELEMETRY_EVENTS,
	recordClientTelemetryEvent,
	redactClientValue,
	resolveClientTelemetryEnvVersion,
	sanitizeNavigationTarget,
	setClientTelemetryEnvVersionForTests,
	summarizeWxEventArg,
} from "./telemetry";

type TelemetryGlobalStore = {
	events?: unknown[];
	envVersion?: unknown;
	envVersionResolved?: boolean;
	realtimeSink?: unknown;
};

function resetTelemetryGlobalStore(): void {
	delete (globalThis as unknown as Record<string, unknown>)
		.__hospitalClientTelemetry;
}

type RecordedRealtimeCall = { level: "info" | "warn"; args: unknown[] };

function installRealtimeRecorder(): RecordedRealtimeCall[] {
	const calls: RecordedRealtimeCall[] = [];
	const manager = {
		info: (...args: unknown[]) => calls.push({ level: "info", args }),
		warn: (...args: unknown[]) => calls.push({ level: "warn", args }),
	};
	(globalThis as unknown as { wx?: unknown }).wx = {
		getRealtimeLogManager: () => manager,
	};
	return calls;
}

function removeWxStub(): void {
	delete (globalThis as unknown as { wx?: unknown }).wx;
}

beforeEach(() => {
	resetTelemetryGlobalStore();
});

afterEach(() => {
	removeWxStub();
	resetTelemetryGlobalStore();
});

test("脱敏投影会替换任意层级的凭证键名，且大小写与分隔符无关", () => {
	const projected = redactClientValue({
		accessToken: "secret-token",
		nested: {
			"Open-Id": "openid-value",
			session_key: "session-key-value",
			paySign: "sign-value",
		},
		items: [{ unionId: "union-value", displayName: "张三" }],
	}) as Record<string, unknown>;

	expect(projected.accessToken).toBe("[已脱敏]");
	const nested = projected.nested as Record<string, unknown>;
	expect(nested["Open-Id"]).toBe("[已脱敏]");
	expect(nested.session_key).toBe("[已脱敏]");
	expect(nested.paySign).toBe("[已脱敏]");
	const firstItem = (projected.items as Array<Record<string, unknown>>)[0];
	expect(firstItem?.unionId).toBe("[已脱敏]");
	expect(firstItem?.displayName).toBe("张三");
});

test("业务封套的短 code 保留，微信登录临时 code 这类长随机值脱敏", () => {
	const projected = redactClientValue({
		code: "0",
		auth: { code: "081Abcdefghijklmnopqrstuvwxyz123456" },
	}) as Record<string, unknown>;

	expect(projected.code).toBe("0");
	const auth = projected.auth as Record<string, unknown>;
	expect(auth.code).toBe("[已脱敏]");
});

test("脱敏投影对长字符串、长数组、深层级和循环引用都有上限", () => {
	const self: Record<string, unknown> = { name: "x" };
	self.self = self;
	const projected = redactClientValue({
		longText: "a".repeat(500),
		list: Array.from({ length: 12 }, (_, index) => index),
		deep: { a: { b: { c: { d: { e: "too-deep" } } } } },
		circular: self,
	}) as Record<string, unknown>;

	expect((projected.longText as string).length).toBeLessThanOrEqual(210);
	expect(projected.longText).toContain("[截断]");
	const list = projected.list as unknown[];
	expect(list).toHaveLength(9);
	expect(list.at(-1)).toBe("[+4 项]");
	const deep = projected.deep as Record<string, unknown>;
	const levelB = (deep.a as Record<string, unknown>).b as Record<
		string,
		unknown
	>;
	expect(levelB.c).toBe("[层级截断]");
	const circular = projected.circular as Record<string, unknown>;
	expect(circular.name).toBe("x");
	expect(circular.self).toBe("[Circular]");
});

test("环境探测失败时按正式版处理，develop/trial 才输出正文", () => {
	// 测试环境没有 wx.getAccountInfoSync，必须 fail-closed 回到 release。
	expect(resolveClientTelemetryEnvVersion()).toBe("release");
	expect(isVerboseClientTelemetry()).toBe(false);

	setClientTelemetryEnvVersionForTests("develop");
	expect(isVerboseClientTelemetry()).toBe(true);
	setClientTelemetryEnvVersionForTests("trial");
	expect(isVerboseClientTelemetry()).toBe(true);
	setClientTelemetryEnvVersionForTests("release");
	expect(isVerboseClientTelemetry()).toBe(false);
	setClientTelemetryEnvVersionForTests(null);
	expect(resolveClientTelemetryEnvVersion()).toBe("release");
});

test("用户操作事件在正式版只保留方法与事件类型，develop 附带脱敏摘要", () => {
	setClientTelemetryEnvVersionForTests("release");
	logClientPageAction("pages/index/index", "onDoctorTapped", {
		type: "tap",
		detail: { formId: "form-1" },
		currentTarget: { dataset: { doctorName: "李四" } },
	});
	let [event] = getRecentClientTelemetryEvents();
	expect(event?.kind).toBe("page.action");
	expect(event?.route).toBe("pages/index/index");
	expect(event?.method).toBe("onDoctorTapped");
	expect(event?.eventType).toBe("tap");
	expect("detail" in (event ?? {})).toBe(false);
	expect("dataset" in (event ?? {})).toBe(false);

	clearClientTelemetryEvents();
	setClientTelemetryEnvVersionForTests("develop");
	logClientPageAction("pages/index/index", "onDoctorTapped", {
		type: "tap",
		detail: { accessToken: "secret" },
		currentTarget: { dataset: { doctorName: "李四" } },
	});
	[event] = getRecentClientTelemetryEvents();
	expect(((event?.dataset as Record<string, unknown>) ?? {}).doctorName).toBe(
		"李四",
	);
	expect(((event?.detail as Record<string, unknown>) ?? {}).accessToken).toBe(
		"[已脱敏]",
	);
});

test("微信事件参数识别：带字符串 type 的对象才算交互事件", () => {
	const summary = summarizeWxEventArg({
		type: "input",
		detail: { value: "王" },
		currentTarget: { dataset: { field: "name" } },
	});
	expect(summary?.eventType).toBe("input");
	expect(summary?.dataset).toEqual({ field: "name" });
	expect(summarizeWxEventArg({ detail: { value: 1 } })).toBeUndefined();
	expect(summarizeWxEventArg(undefined)).toBeUndefined();
});

test("导航目标剥离查询串，非内部路径折叠为 unknown", () => {
	expect(sanitizeNavigationTarget("/pages/index/index?patientId=p1#x")).toBe(
		"/pages/index/index",
	);
	expect(sanitizeNavigationTarget("https://provider.invalid/raw")).toBe(
		"/unknown",
	);
});

test("事件环只保留最近固定数量，getRecent 返回副本", () => {
	setClientTelemetryEnvVersionForTests("release");
	for (
		let index = 0;
		index < MAX_RECENT_CLIENT_TELEMETRY_EVENTS + 2;
		index += 1
	) {
		recordClientTelemetryEvent({
			kind: "navigation",
			action: "navigateTo",
			target: `/pages/item-${index}/item`,
		});
	}
	const events = getRecentClientTelemetryEvents();
	expect(events).toHaveLength(MAX_RECENT_CLIENT_TELEMETRY_EVENTS);
	expect(events[0]?.target).toBe("/pages/item-2/item");
	const copy = getRecentClientTelemetryEvents();
	copy.pop();
	expect(getRecentClientTelemetryEvents()).toHaveLength(
		MAX_RECENT_CLIENT_TELEMETRY_EVENTS,
	);
	clearClientTelemetryEvents();
	expect(getRecentClientTelemetryEvents()).toHaveLength(0);
});

test("实时日志只上报元数据，正文摘要永不进入实时日志", () => {
	const calls = installRealtimeRecorder();
	setClientTelemetryEnvVersionForTests("trial");
	logClientPageAction("pages/index/index", "onDoctorTapped", {
		type: "tap",
		detail: { accessToken: "secret" },
		currentTarget: { dataset: { doctorName: "李四" } },
	});
	recordClientTelemetryEvent({
		kind: "page.action",
		route: "pages/my/my",
		method: "onSubmit",
		outcome: "failed",
		errorName: "TypeError",
	});

	expect(calls).toHaveLength(2);
	const [tapCall, failureCall] = calls;
	const tapPayload = String(tapCall?.args[1] ?? "");
	expect(tapPayload).toContain('"kind":"page.action"');
	expect(tapPayload).toContain('"eventType":"tap"');
	expect(tapPayload).not.toContain("secret");
	expect(tapPayload).not.toContain("李四");
	expect(tapPayload).not.toContain('"detail"');
	const failurePayload = String(failureCall?.args[1] ?? "");
	expect(failureCall?.level).toBe("warn");
	expect(failurePayload).toContain('"outcome":"failed"');
	expect(failurePayload).toContain('"errorName":"TypeError"');
});

test("控制台被禁用时记录事件不抛错", () => {
	setClientTelemetryEnvVersionForTests("release");
	const originalInfo = console.info;
	const originalWarn = console.warn;
	console.info = (): void => {
		throw new Error("console disabled");
	};
	console.warn = (): void => {
		throw new Error("console disabled");
	};
	try {
		expect(() => {
			recordClientTelemetryEvent({
				kind: "app.launch",
				fields: { mode: "dev" },
			});
		}).not.toThrow();
	} finally {
		console.info = originalInfo;
		console.warn = originalWarn;
	}
});

test("页面失败与转换点事件携带数字码、字符串码和 requestId", () => {
	setClientTelemetryEnvVersionForTests("release");
	const apiLikeError = Object.assign(new Error("provider down"), {
		code: "provider-temporarily-unavailable",
		numericCode: 10810,
		requestId: "req-transform-1",
	});
	logClientPageFailure("page.action", "pages/my/my", "onRefresh", apiLikeError);
	logClientErrorTransformed("api-client.command-session-retry", apiLikeError);

	const events = getRecentClientTelemetryEvents();
	expect(events).toHaveLength(2);
	expect(events[0]?.fields?.errorCode).toBe(10810);
	expect(events[0]?.fields?.errorKey).toBe("provider-temporarily-unavailable");
	expect(events[0]?.fields?.requestId).toBe("req-transform-1");
	expect(events[1]?.kind).toBe("error.transformed");
	expect(events[1]?.method).toBe("api-client.command-session-retry");
	expect(events[1]?.fields?.errorCode).toBe(10810);

	// 非错误对象的失败回落 unknown 数字码，仍保留事件。
	logClientPageFailure("page.lifecycle", "pages/index/index", "onLoad", "boom");
	const lastEvent = getRecentClientTelemetryEvents().at(-1);
	expect(lastEvent?.fields?.errorCode).toBe(10900);
	expect("errorKey" in (lastEvent?.fields ?? {})).toBe(false);
});
