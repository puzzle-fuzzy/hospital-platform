import { expect, test } from "bun:test";
import {
	isAllowedApiPrefix,
	normalizeApiPrefix,
	request,
	requestWithSession,
} from "./api-client";
import {
	advanceSessionGeneration,
	getSessionGeneration,
} from "./session-generation";

test("API 前缀只接受已注册版本，并清理旧缓存中的未知版本", () => {
	expect(isAllowedApiPrefix("/api/v1")).toBe(true);
	expect(isAllowedApiPrefix("/api/v2")).toBe(true);
	expect(isAllowedApiPrefix("/api/v3")).toBe(false);
	expect(isAllowedApiPrefix("/api/v2/reports")).toBe(false);
	expect(normalizeApiPrefix(" /api/v2/ ", "/api/v1")).toBe("/api/v2");
	expect(normalizeApiPrefix("/api/v999", "/api/v2")).toBe("/api/v2");
	expect(normalizeApiPrefix(undefined)).toBe("/api/v1");
});

test("真实请求会把旧缓存前缀回退到当前地址对应的公共版本", async () => {
	type TestGlobal = typeof globalThis & {
		getApp: (() => unknown) | undefined;
		wx: unknown;
	};
	type RequestOptions = {
		url: string;
		success: (response: unknown) => void;
	};
	const testGlobal = globalThis as TestGlobal;
	const previousGetApp = testGlobal.getApp;
	const previousWx = testGlobal.wx;
	const requestUrls: string[] = [];
	const globalData = {
		apiBaseUrl: "https://test-hp.meiyi.pro",
		apiPrefix: "",
		accessToken: "",
		sessionStatus: "signed_out",
	};

	testGlobal.getApp = () => ({ globalData });
	testGlobal.wx = {
		getStorageSync: (key: string) => (key === "api_prefix" ? "/api/v999" : ""),
		request: (options: RequestOptions) => {
			requestUrls.push(options.url);
			options.success({ statusCode: 200, data: { success: true } });
		},
	};

	try {
		await request({ url: "/health/live" });
		expect(requestUrls.at(-1)).toBe(
			"https://test-hp.meiyi.pro/api/v2/health/live",
		);

		// 同一个旧缓存进入本地 HTTP 调试地址时，必须回到本地 API 的 v1，
		// 不能把公网 v2 或未知版本继续带入本地请求。
		globalData.apiBaseUrl = "http://127.0.0.1:3000";
		await request({ url: "/health/live" });
		expect(requestUrls.at(-1)).toBe("http://127.0.0.1:3000/api/v1/health/live");
	} finally {
		testGlobal.getApp = previousGetApp;
		testGlobal.wx = previousWx;
	}
});

test("认证请求在会话切换后丢弃已经返回的旧快照", async () => {
	type TestGlobal = typeof globalThis & {
		getApp: (() => unknown) | undefined;
		wx: unknown;
	};
	const testGlobal = globalThis as TestGlobal;
	const previousGetApp = testGlobal.getApp;
	const previousWx = testGlobal.wx;
	let completeRequest: ((response: unknown) => void) | undefined;

	testGlobal.getApp = () => ({
		globalData: {
			apiBaseUrl: "https://test-hp.meiyi.pro",
			apiPrefix: "/api/v2",
			accessToken: "token-for-old-session",
			sessionStatus: "signed_in",
		},
	});
	testGlobal.wx = {
		getStorageSync: (key: string) =>
			key === "access_token" ? "token-for-old-session" : "",
		request: (options: { success: (response: unknown) => void }) => {
			completeRequest = options.success;
		},
	};

	try {
		const pending = requestWithSession<{ success: true }>({
			url: "/patients",
		});
		await Promise.resolve();
		if (!completeRequest) throw new Error("测试请求没有进入微信请求层");

		// 模拟另一个登录流程已经替换 token；旧 HTTP 请求随后才返回 200。
		advanceSessionGeneration();
		completeRequest({ statusCode: 200, data: { success: true } });

		await expect(pending).rejects.toMatchObject({
			code: "session-changed",
		});
	} finally {
		testGlobal.getApp = previousGetApp;
		testGlobal.wx = previousWx;
	}

	expect(getSessionGeneration()).toBeGreaterThan(0);
});

test("非 GET 命令遇到会话切换时不把旧请求重放到新账号", async () => {
	type TestGlobal = typeof globalThis & {
		getApp: (() => unknown) | undefined;
		wx: unknown;
	};
	const testGlobal = globalThis as TestGlobal;
	const previousGetApp = testGlobal.getApp;
	const previousWx = testGlobal.wx;
	let completeRequest: ((response: unknown) => void) | undefined;
	let requestCount = 0;
	const globalData = {
		apiBaseUrl: "https://test-hp.meiyi.pro",
		apiPrefix: "/api/v2",
		accessToken: "token-for-old-session",
		sessionStatus: "signed_in",
	};

	testGlobal.getApp = () => ({ globalData });
	testGlobal.wx = {
		getStorageSync: (key: string) =>
			key === "access_token" ? globalData.accessToken : "",
		request: (options: { success: (response: unknown) => void }) => {
			requestCount += 1;
			completeRequest = options.success;
		},
		setStorageSync: (_key: string, value: string) => {
			globalData.accessToken = value;
		},
		removeStorageSync: (_key: string) => {
			globalData.accessToken = "";
		},
	};

	try {
		const pending = requestWithSession({
			url: "/me/profile",
			method: "PUT",
			data: { version: 1, displayName: "新资料" },
		});
		await Promise.resolve();
		if (!completeRequest) throw new Error("测试请求没有进入微信请求层");

		// 另一个页面已经完成账号切换；旧 PUT 返回 401 后不得使用
		// 新 token 再发一次相同请求。
		globalData.accessToken = "token-for-new-session";
		advanceSessionGeneration();
		completeRequest({
			statusCode: 401,
			data: { success: false, error: { code: "unauthorized" } },
		});

		await expect(pending).rejects.toMatchObject({ code: "session-changed" });
		expect(requestCount).toBe(1);
		expect(globalData.accessToken).toBe("token-for-new-session");
	} finally {
		testGlobal.getApp = previousGetApp;
		testGlobal.wx = previousWx;
	}
});

test("非 GET 命令失效后只清理旧会话，不自动登录或重放", async () => {
	type TestGlobal = typeof globalThis & {
		getApp: (() => unknown) | undefined;
		wx: unknown;
	};
	const testGlobal = globalThis as TestGlobal;
	const previousGetApp = testGlobal.getApp;
	const previousWx = testGlobal.wx;
	let completeRequest: ((response: unknown) => void) | undefined;
	let requestCount = 0;
	let loginCount = 0;
	const globalData = {
		apiBaseUrl: "https://test-hp.meiyi.pro",
		apiPrefix: "/api/v2",
		accessToken: "expired-token",
		sessionStatus: "signed_in",
	};

	testGlobal.getApp = () => ({ globalData });
	testGlobal.wx = {
		getStorageSync: (key: string) =>
			key === "access_token" ? globalData.accessToken : "",
		removeStorageSync: (_key: string) => {
			globalData.accessToken = "";
		},
		setStorageSync: (_key: string, value: string) => {
			globalData.accessToken = value;
		},
		login: () => {
			loginCount += 1;
		},
		request: (options: { success: (response: unknown) => void }) => {
			requestCount += 1;
			completeRequest = options.success;
		},
	};

	try {
		const pending = requestWithSession({
			url: "/patients/sync",
			method: "POST",
			data: {},
			idempotencyKey: "sync-command-001",
		});
		await Promise.resolve();
		if (!completeRequest) throw new Error("测试请求没有进入微信请求层");
		completeRequest({
			statusCode: 401,
			data: { success: false, error: { code: "unauthorized" } },
		});

		await expect(pending).rejects.toMatchObject({ code: "unauthorized" });
		expect(requestCount).toBe(1);
		expect(loginCount).toBe(0);
		expect(globalData.accessToken).toBe("");
	} finally {
		testGlobal.getApp = previousGetApp;
		testGlobal.wx = previousWx;
	}
});
