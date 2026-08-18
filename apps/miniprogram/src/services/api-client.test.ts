import { expect, test } from "bun:test";
import { requestWithSession } from "./api-client";
import {
	advanceSessionGeneration,
	getSessionGeneration,
} from "./session-generation";

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
