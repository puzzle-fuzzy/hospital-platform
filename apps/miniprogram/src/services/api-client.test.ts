import { expect, test } from "bun:test";
import {
	isAllowedApiPrefix,
	normalizeApiPrefix,
	request,
	requestWithSession,
	requireAuthSessionResponse,
	requireCanonicalUserProfileResponse,
	requireCurrentUserResponse,
	requireReportDetailResponse,
	requireReportListResponse,
	requireSuccessDataResponse,
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

test("平台成功包络必须在业务读模型之前通过运行时校验", () => {
	const valid = { success: true as const, data: { items: [], total: 0 } };
	expect(requireSuccessDataResponse<typeof valid.data>(valid)).toEqual(valid);

	for (const invalid of [
		{ success: false, data: valid.data },
		{ success: true },
		{ success: true, data: null },
		{ data: valid.data },
	]) {
		expect(() => requireSuccessDataResponse(invalid)).toThrow(
			"API success response is invalid",
		);
	}
});

test("微信登录响应必须完整通过会话 contract 才能进入 token 持久化边界", () => {
	const valid = {
		success: true as const,
		data: {
			accessToken: "fixture-session-0001",
			tokenType: "Bearer" as const,
			expiresInSeconds: 3600,
			user: { id: "user-001" },
		},
	};

	expect(requireAuthSessionResponse(valid)).toEqual(valid);
	expect(
		requireAuthSessionResponse({
			...valid,
			data: { ...valid.data, providerSubject: "must-be-dropped" },
		}),
	).toEqual(valid);

	const invalidResponses: unknown[] = [
		{ ...valid, success: false },
		{ success: true, data: { ...valid.data, accessToken: "" } },
		{ success: true, data: { ...valid.data, accessToken: " token " } },
		{ success: true, data: { ...valid.data, accessToken: "token\nvalue" } },
		{ success: true, data: { ...valid.data, tokenType: "Basic" } },
		{ success: true, data: { ...valid.data, expiresInSeconds: 1.5 } },
		{ success: true, data: { ...valid.data, expiresInSeconds: 0 } },
		{ success: true, data: { ...valid.data, user: { id: "" } } },
		{ success: true, data: { ...valid.data, user: { id: " user-001" } } },
		{
			success: true,
			data: { ...valid.data, user: { id: "x".repeat(65) } },
		},
	];

	for (const invalid of invalidResponses) {
		expect(() => requireAuthSessionResponse(invalid)).toThrow(
			"Auth session response is invalid",
		);
	}
});

test("当前用户响应必须提供安全的 owner 引用，不能用任意 200 JSON 恢复会话", () => {
	const valid = {
		success: true as const,
		data: { user: { id: "user-001" } },
	};

	expect(requireCurrentUserResponse(valid)).toEqual(valid);
	const invalidResponses: unknown[] = [
		{ ...valid, success: false },
		{ success: true, data: {} },
		{ success: true, data: { user: { id: "" } } },
		{ success: true, data: { user: { id: "user-001\u0000" } } },
		{ success: true, data: { user: { id: "x".repeat(65) } } },
	];

	for (const invalid of invalidResponses) {
		expect(() => requireCurrentUserResponse(invalid)).toThrow(
			"Current user response is invalid",
		);
	}
});

test("普通资料成功响应必须保留完整 canonical 快照并通过运行时类型校验", () => {
	const valid = {
		success: true,
		data: {
			displayName: "平台用户",
			gender: "unknown",
			age: null,
			email: null,
			version: 2,
		},
	} as const;

	expect(requireCanonicalUserProfileResponse(valid)).toEqual(valid);

	const invalidResponses: unknown[] = [
		{ success: true, data: { ...valid.data, displayName: undefined } },
		{ success: true, data: { ...valid.data, displayName: " 平台用户" } },
		{ success: true, data: { ...valid.data, displayName: "平台\n用户" } },
		{ success: true, data: { ...valid.data, gender: "other" } },
		{ success: true, data: { ...valid.data, age: 151 } },
		{ success: true, data: { ...valid.data, version: "2" } },
		{ success: true, data: { ...valid.data, email: { value: "x@y.test" } } },
		{ success: true, data: { ...valid.data, email: "invalid-email" } },
		{ success: true, data: { ...valid.data, email: " user@example.com" } },
		{ success: true, data: { ...valid.data, email: "user@\nexample.com" } },
		{ success: true, data: { ...valid.data, version: 4_294_967_296 } },
		{ success: true, data: { displayName: "平台用户" } },
	];

	for (const invalid of invalidResponses) {
		try {
			requireCanonicalUserProfileResponse(invalid);
			throw new Error("expected invalid profile response to be rejected");
		} catch (error) {
			expect(error).toMatchObject({ code: "provider-response-invalid" });
		}
	}

	expect(
		requireCanonicalUserProfileResponse({
			...valid,
			data: { ...valid.data, extra: "must-be-dropped" },
		}),
	).toEqual(valid);
});

test("报告目录响应必须保持公开字段、详情引用和列表总数一致", () => {
	const valid = {
		success: true as const,
		data: {
			items: [
				{
					reportId: "report_001",
					kind: "laboratory" as const,
					title: "血常规",
					reportedAt: "2026-08-19 10:30",
					status: "available" as const,
					hasAttachment: false,
				},
				{
					kind: "imaging" as const,
					title: "胸部影像",
					reportedAt: "2026-08-18",
					status: "abnormal" as const,
					hasAttachment: true,
				},
			],
			total: 2,
		},
	};

	expect(requireReportListResponse(valid)).toEqual(valid);

	const invalidResponses: unknown[] = [
		{ ...valid, success: false },
		{ ...valid, data: { ...valid.data, total: 1 } },
		{
			...valid,
			data: {
				...valid.data,
				items: [{ ...valid.data.items[0], kind: "other" }],
				total: 1,
			},
		},
		{
			...valid,
			data: {
				...valid.data,
				items: [{ ...valid.data.items[0], title: " 血常规" }],
				total: 1,
			},
		},
		{
			...valid,
			data: {
				...valid.data,
				items: [{ ...valid.data.items[0] }, { ...valid.data.items[0] }],
				total: 2,
			},
		},
		{
			...valid,
			data: {
				...valid.data,
				items: [{ ...valid.data.items[1], reportId: "image-report" }],
				total: 1,
			},
		},
	];

	for (const invalid of invalidResponses) {
		expect(() => requireReportListResponse(invalid)).toThrow(
			"Report list response",
		);
	}
});

test("报告详情响应必须匹配请求引用并保持检测项 contract", () => {
	const valid = {
		success: true as const,
		data: {
			reportId: "report_001",
			kind: "laboratory" as const,
			title: "血常规",
			reportedAt: "2026-08-19 10:30",
			items: [
				{
					name: "白细胞",
					result: "10.2",
					unit: "10^9/L",
					referenceRange: "3.5-9.5",
					flag: "high" as const,
				},
			],
			hasAttachment: false,
		},
	};

	expect(requireReportDetailResponse(valid, "report_001")).toEqual(valid);

	const invalidResponses: unknown[] = [
		{ ...valid, success: false },
		{ ...valid, data: { ...valid.data, reportId: "report_002" } },
		{ ...valid, data: { ...valid.data, kind: "imaging" } },
		{
			...valid,
			data: {
				...valid.data,
				items: [{ ...valid.data.items[0], flag: "not-a-flag" }],
			},
		},
		{
			...valid,
			data: {
				...valid.data,
				items: [{ ...valid.data.items[0], name: "白细胞\n异常" }],
			},
		},
		{
			...valid,
			data: {
				...valid.data,
				items: [{ ...valid.data.items[0], unit: null }],
			},
		},
	];

	for (const invalid of invalidResponses) {
		expect(() => requireReportDetailResponse(invalid, "report_001")).toThrow(
			"Report",
		);
	}
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

test("错误响应按大小写无关方式读取 X-Request-Id，保持客户端与服务端同链", async () => {
	type TestGlobal = typeof globalThis & {
		getApp: (() => unknown) | undefined;
		wx: unknown;
	};
	type RequestOptions = {
		success: (response: unknown) => void;
	};
	const testGlobal = globalThis as TestGlobal;
	const previousGetApp = testGlobal.getApp;
	const previousWx = testGlobal.wx;

	testGlobal.getApp = () => ({
		globalData: {
			apiBaseUrl: "https://test-hp.meiyi.pro",
			apiPrefix: "/api/v2",
			accessToken: "",
			sessionStatus: "signed_out",
		},
	});
	testGlobal.wx = {
		getStorageSync: () => "",
		request: (options: RequestOptions) => {
			options.success({
				statusCode: 503,
				header: { "X-ReQuEsT-Id": "server-error-trace-001" },
				data: {
					success: false,
					error: {
						code: "persistence-temporarily-unavailable",
					},
				},
			});
		},
	};

	try {
		await expect(request({ url: "/health/ready" })).rejects.toMatchObject({
			statusCode: 503,
			code: "persistence-temporarily-unavailable",
			requestId: "server-error-trace-001",
		});
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

test("认证命令在发出前发生会话切换时不使用新 token 发送", async () => {
	type TestGlobal = typeof globalThis & {
		getApp: (() => unknown) | undefined;
		wx: unknown;
	};
	const testGlobal = globalThis as TestGlobal;
	const previousGetApp = testGlobal.getApp;
	const previousWx = testGlobal.wx;
	let getAppCalls = 0;
	let requestCount = 0;
	let sentAuthorization = "";
	const globalData = {
		apiBaseUrl: "https://test-hp.meiyi.pro",
		apiPrefix: "/api/v2",
		accessToken: "token-for-old-session",
		sessionStatus: "signed_in",
	};

	testGlobal.getApp = () => {
		getAppCalls += 1;
		if (getAppCalls === 2) {
			// 第二次读取发生在真正发出请求前；旧实现会在这里重新读取
			// 新 token 并发送命令，导致“响应被丢弃但副作用已发生”。
			globalData.accessToken = "token-for-new-session";
			advanceSessionGeneration();
		}
		return { globalData };
	};
	testGlobal.wx = {
		getStorageSync: (key: string) =>
			key === "access_token" ? globalData.accessToken : "",
		request: (options: { header?: Record<string, string> }) => {
			requestCount += 1;
			sentAuthorization = options.header?.Authorization ?? "";
		},
	};

	try {
		await expect(
			requestWithSession({
				url: "/patients/sync",
				method: "POST",
				data: {},
				idempotencyKey: "sync-command-before-send-001",
			}),
		).rejects.toMatchObject({ code: "session-changed" });
		expect(requestCount).toBe(0);
		expect(sentAuthorization).toBe("");
	} finally {
		testGlobal.getApp = previousGetApp;
		testGlobal.wx = previousWx;
	}
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

test("GET 重新登录后的第二次 401 会清理同一代无效 token", async () => {
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
		login: (options: { success: (value: { code: string }) => void }) => {
			loginCount += 1;
			options.success({ code: `wechat-code-${loginCount}` });
		},
		request: (options: RequestOptions) => {
			requestCount += 1;
			if (options.url.endsWith("/auth/wechat")) {
				options.success({
					statusCode: 200,
					data: {
						success: true,
						data: {
							accessToken: "new-but-invalid-token",
							tokenType: "Bearer",
							expiresInSeconds: 3600,
							user: { id: "user-001" },
						},
					},
				});
				return;
			}
			options.success({
				statusCode: 401,
				data: { success: false, error: { code: "unauthorized" } },
			});
		},
	};

	try {
		await expect(
			requestWithSession({ url: "/patients" }),
		).rejects.toMatchObject({ code: "unauthorized", statusCode: 401 });
		expect(loginCount).toBe(1);
		expect(requestCount).toBe(3);
		expect(globalData.accessToken).toBe("");
		expect(globalData.sessionStatus).toBe("signed_out");
	} finally {
		testGlobal.getApp = previousGetApp;
		testGlobal.wx = previousWx;
	}
});
