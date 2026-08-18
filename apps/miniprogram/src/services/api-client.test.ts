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
