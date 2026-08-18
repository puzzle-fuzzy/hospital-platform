import { expect, test } from "bun:test";
import { runProviderDirectorySmoke } from "./provider-directory-smoke";

function jsonResponse(body: unknown, status = 200): Response {
	return new Response(JSON.stringify(body), {
		status,
		headers: { "content-type": "application/json" },
	});
}

test("provider directory smoke only uses the platform API and verifies safe responses", async () => {
	const requests: Array<{ url: string; authorization: string | null }> = [];
	const result = await runProviderDirectorySmoke({
		baseUrl: "https://hospital.example.test",
		accessToken: "platform-access-token",
		capabilities: ["patients"],
		date: new Date("2026-08-15T00:00:00.000Z"),
		traceIdFactory: () => "smoke-trace-001",
		fetcher: async (input, init) => {
			const url = String(input);
			requests.push({
				url,
				authorization: new Headers(init?.headers).get("authorization"),
			});
			if (url.endsWith("/health/live")) {
				return jsonResponse({
					success: true,
					data: { status: "ok", service: "hospital-api", version: "0.1.0" },
				});
			}
			if (url.endsWith("/health/ready")) {
				return jsonResponse({
					success: true,
					data: { status: "ready", dependencies: {} },
				});
			}
			return jsonResponse({
				success: true,
				data: {
					items: [
						{
							id: "internal-patient-001",
							displayName: "张三",
							relationship: "self",
							cardNumberMasked: "******0001",
							source: "hospital-his",
							clinicalAccess: "ready",
						},
					],
					total: 1,
				},
			});
		},
	});

	expect(result.passed).toBe(true);
	expect(result.checks).toEqual([
		{ name: "health-live", status: "passed", traceId: "smoke-trace-001" },
		{ name: "health-ready", status: "passed", traceId: "smoke-trace-001" },
		{
			name: "patients",
			status: "passed",
			itemCount: 1,
			traceId: "smoke-trace-001",
		},
	]);
	expect(requests.map((request) => request.url)).toEqual([
		"https://hospital.example.test/health/live",
		"https://hospital.example.test/health/ready",
		"https://hospital.example.test/api/v1/patients",
	]);
	expect(requests[0]?.authorization).toBeNull();
	expect(requests[1]?.authorization).toBeNull();
	expect(requests[2]?.authorization).toBe("Bearer platform-access-token");
});

test("provider directory smoke uses the public v2 prefix without auth on health probes", async () => {
	const requests: Array<{
		url: string;
		authorization: string | null;
		method: string;
		idempotencyKey: string | null;
	}> = [];
	const result = await runProviderDirectorySmoke({
		baseUrl: "https://hospital.example.test",
		apiPrefix: "/api/v2",
		accessToken: "platform-access-token",
		capabilities: ["patients", "patient-sync"],
		traceIdFactory: (() => {
			const traceIds = ["sync-first", "sync-replay"];
			return () => traceIds.shift() ?? "sync-replay";
		})(),
		fetcher: async (input, init) => {
			const url = String(input);
			const headers = new Headers(init?.headers);
			requests.push({
				url,
				authorization: headers.get("authorization"),
				method: init?.method ?? "GET",
				idempotencyKey: headers.get("idempotency-key"),
			});
			if (url.endsWith("/api/v2/health/live")) {
				return jsonResponse({ success: true, data: { status: "ok" } });
			}
			if (url.endsWith("/api/v2/health/ready")) {
				return jsonResponse({ success: true, data: { status: "ready" } });
			}
			return jsonResponse({
				success: true,
				data: {
					items: [
						{
							id: "internal-patient-001",
							displayName: "张三",
							relationship: "self",
							cardNumberMasked: "******0001",
						},
					],
					total: 1,
				},
			});
		},
	});

	expect(result.passed).toBe(true);
	expect(requests.map((request) => request.url)).toEqual([
		"https://hospital.example.test/api/v2/health/live",
		"https://hospital.example.test/api/v2/health/ready",
		"https://hospital.example.test/api/v2/patients/sync",
		"https://hospital.example.test/api/v2/patients/sync",
		"https://hospital.example.test/api/v2/patients",
	]);
	expect(requests[0]?.authorization).toBeNull();
	expect(requests[1]?.authorization).toBeNull();
	expect(requests[2]?.authorization).toBe("Bearer platform-access-token");
	expect(requests[3]).toMatchObject({
		method: "POST",
		authorization: "Bearer platform-access-token",
		idempotencyKey: expect.stringMatching(/^provider-smoke-/),
	});
	expect(requests[4]).toMatchObject({
		method: "GET",
		authorization: "Bearer platform-access-token",
		url: "https://hospital.example.test/api/v2/patients",
	});
	// Bun 当前版本对两个同值 Header 字符串的 `toBe` 报告不稳定，这里验证值相等即可。
	expect(requests[3]?.idempotencyKey).toEqual(requests[2]?.idempotencyKey);
});

test("provider directory smoke can explicitly verify idempotent patient synchronization", async () => {
	const requests: Array<{
		url: string;
		method: string;
		idempotencyKey: string | null;
	}> = [];
	const result = await runProviderDirectorySmoke({
		baseUrl: "https://hospital.example.test",
		accessToken: "platform-access-token",
		capabilities: ["patient-sync"],
		traceIdFactory: (() => {
			const traceIds = [
				"health-live-trace",
				"health-ready-trace",
				"sync-trace-001",
				"sync-trace-002",
			];
			return () => traceIds.shift() ?? "sync-trace-002";
		})(),
		fetcher: async (input, init) => {
			const headers = new Headers(init?.headers);
			const url = String(input);
			requests.push({
				url,
				method: init?.method ?? "GET",
				idempotencyKey: headers.get("idempotency-key"),
			});
			if (url.endsWith("/health/live")) {
				return jsonResponse({ success: true, data: { status: "ok" } });
			}
			if (url.endsWith("/health/ready")) {
				return jsonResponse({ success: true, data: { status: "ready" } });
			}
			if (url.endsWith("/api/v1/patients")) {
				return jsonResponse({
					success: true,
					data: {
						items: [
							{
								id: "patient-001",
								displayName: "张三",
								relationship: "self",
								cardNumberMasked: "******0001",
							},
						],
						total: 1,
					},
				});
			}
			return jsonResponse({
				success: true,
				data: {
					items: [
						{
							id: "internal-patient-001",
							displayName: "张三",
							relationship: "self",
							cardNumberMasked: "******0001",
							source: "hospital-his",
							clinicalAccess: "ready",
						},
					],
					total: 1,
				},
			});
		},
	});

	expect(result.passed).toBe(true);
	expect(result.checks).toEqual([
		{ name: "health-live", status: "passed", traceId: "health-live-trace" },
		{ name: "health-ready", status: "passed", traceId: "health-ready-trace" },
		{
			name: "patient-sync",
			status: "passed",
			itemCount: 1,
			traceId: "sync-trace-001",
		},
		{
			name: "patient-sync-replay",
			status: "passed",
			itemCount: 1,
			traceId: "sync-trace-002",
		},
	]);
	expect(result.checks.at(-1)).toEqual({
		name: "patient-sync-replay",
		status: "passed",
		itemCount: 1,
		traceId: "sync-trace-002",
	});
	expect(requests).toEqual([
		{
			url: "https://hospital.example.test/health/live",
			method: "GET",
			idempotencyKey: null,
		},
		{
			url: "https://hospital.example.test/health/ready",
			method: "GET",
			idempotencyKey: null,
		},
		{
			url: "https://hospital.example.test/api/v1/patients/sync",
			method: "POST",
			idempotencyKey: "provider-smoke-sync-trace-001",
		},
		{
			url: "https://hospital.example.test/api/v1/patients/sync",
			method: "POST",
			idempotencyKey: "provider-smoke-sync-trace-001",
		},
	]);
	expect(requests.at(-1)).toEqual({
		url: "https://hospital.example.test/api/v1/patients/sync",
		method: "POST",
		idempotencyKey: "provider-smoke-sync-trace-001",
	});
});

test("provider directory smoke verifies the platform session before patient reads", async () => {
	const requests: string[] = [];
	const result = await runProviderDirectorySmoke({
		baseUrl: "https://hospital.example.test",
		accessToken: "platform-access-token",
		capabilities: ["session", "patients"],
		fetcher: async (input) => {
			const url = String(input);
			requests.push(url);
			if (url.endsWith("/health/live")) {
				return jsonResponse({ success: true, data: { status: "ok" } });
			}
			if (url.endsWith("/health/ready")) {
				return jsonResponse({ success: true, data: { status: "ready" } });
			}
			if (url.endsWith("/me")) {
				return jsonResponse({
					success: true,
					data: { user: { id: "internal-user-001" } },
				});
			}
			return jsonResponse({
				success: true,
				data: {
					items: [
						{
							id: "internal-patient-001",
							displayName: "张三",
							relationship: "self",
							cardNumberMasked: "******0001",
						},
					],
					total: 1,
				},
			});
		},
	});

	expect(result.passed).toBe(true);
	expect(result.checks.map((check) => check.name)).toEqual([
		"health-live",
		"health-ready",
		"session",
		"patients",
	]);
	expect(requests).toEqual([
		"https://hospital.example.test/health/live",
		"https://hospital.example.test/health/ready",
		"https://hospital.example.test/api/v1/me",
		"https://hospital.example.test/api/v1/patients",
	]);
});

test("provider directory smoke verifies ordinary profile shape without writing data", async () => {
	const requests: Array<{ url: string; method: string }> = [];
	const result = await runProviderDirectorySmoke({
		baseUrl: "https://hospital.example.test",
		accessToken: "platform-access-token",
		capabilities: ["session", "profile-read"],
		fetcher: async (input, init) => {
			const url = String(input);
			requests.push({ url, method: init?.method ?? "GET" });
			if (url.endsWith("/health/live")) {
				return jsonResponse({ success: true, data: { status: "ok" } });
			}
			if (url.endsWith("/health/ready")) {
				return jsonResponse({ success: true, data: { status: "ready" } });
			}
			if (url.endsWith("/api/v1/me")) {
				return jsonResponse({
					success: true,
					data: { user: { id: "internal-user-001" } },
				});
			}
			if (url.endsWith("/api/v1/me/profile")) {
				return jsonResponse({
					success: true,
					data: {
						displayName: "测试用户",
						gender: "unknown",
						age: null,
						email: null,
						version: 0,
					},
				});
			}
			throw new Error("provider route must not be called");
		},
	});

	expect(result.passed).toBe(true);
	expect(result.checks.map((check) => check.name)).toEqual([
		"health-live",
		"health-ready",
		"session",
		"profile-read",
	]);
	expect(requests).toEqual([
		{
			url: "https://hospital.example.test/health/live",
			method: "GET",
		},
		{
			url: "https://hospital.example.test/health/ready",
			method: "GET",
		},
		{
			url: "https://hospital.example.test/api/v1/me",
			method: "GET",
		},
		{
			url: "https://hospital.example.test/api/v1/me/profile",
			method: "GET",
		},
	]);
	// 资料 smoke 只允许 GET；不会因为普通资料契约存在就偷偷开放写入验收。
	expect(requests.every((request) => request.method === "GET")).toBe(true);
});

test("provider directory smoke rejects malformed ordinary profile data", async () => {
	const requests: string[] = [];
	const result = await runProviderDirectorySmoke({
		baseUrl: "https://hospital.example.test",
		accessToken: "platform-access-token",
		// 普通资料属于独立的 owner 资料域，不是患者目录读取的前置条件。
		// 这里单独验证资料 schema，避免把资料异常误测成患者域失败。
		capabilities: ["profile-read"],
		fetcher: async (input) => {
			const url = String(input);
			requests.push(url);
			if (url.endsWith("/health/live")) {
				return jsonResponse({ success: true, data: { status: "ok" } });
			}
			if (url.endsWith("/health/ready")) {
				return jsonResponse({ success: true, data: { status: "ready" } });
			}
			if (url.endsWith("/me/profile")) {
				return jsonResponse({
					success: true,
					data: {
						displayName: "测试用户",
						gender: "unknown",
						age: "32",
						email: null,
						version: 0,
					},
				});
			}
			if (url.endsWith("/me")) {
				return jsonResponse({
					success: true,
					data: { user: { id: "internal-user-001" } },
				});
			}
			throw new Error(
				"provider route must not be called after profile failure",
			);
		},
	});

	expect(result.passed).toBe(false);
	expect(result.checks.at(-1)).toEqual({
		name: "profile-read",
		status: "failed",
		errorType: "ProviderSmokeRequestError",
		traceId: expect.any(String),
	});
	expect(requests.at(-1)).toContain("/api/v1/me/profile");
	expect(requests.some((url) => url.endsWith("/api/v1/patients"))).toBe(false);
});

test("provider directory smoke stops before provider reads when the platform session is invalid", async () => {
	const requests: string[] = [];
	const result = await runProviderDirectorySmoke({
		baseUrl: "https://hospital.example.test",
		accessToken: "platform-access-token",
		capabilities: ["session", "patients"],
		fetcher: async (input) => {
			const url = String(input);
			requests.push(url);
			if (url.endsWith("/health/live")) {
				return jsonResponse({ success: true, data: { status: "ok" } });
			}
			if (url.endsWith("/health/ready")) {
				return jsonResponse({ success: true, data: { status: "ready" } });
			}
			return jsonResponse({ success: true, data: { user: {} } });
		},
	});

	expect(result.passed).toBe(false);
	expect(result.checks.at(-1)).toEqual({
		name: "session",
		status: "failed",
		errorType: "ProviderSmokeRequestError",
		traceId: expect.any(String),
	});
	expect(requests).toEqual([
		"https://hospital.example.test/health/live",
		"https://hospital.example.test/health/ready",
		"https://hospital.example.test/api/v1/me",
	]);
});

test("provider directory smoke verifies both outpatient payment read statuses", async () => {
	const requests: Array<{ url: string; authorization: string | null }> = [];
	const result = await runProviderDirectorySmoke({
		baseUrl: "https://hospital.example.test",
		accessToken: "platform-access-token",
		patientId: "patient-001",
		capabilities: ["outpatient-payments"],
		fetcher: async (input, init) => {
			const url = String(input);
			requests.push({
				url,
				authorization: new Headers(init?.headers).get("authorization"),
			});
			if (url.endsWith("/health/live")) {
				return jsonResponse({ success: true, data: { status: "ok" } });
			}
			if (url.endsWith("/health/ready")) {
				return jsonResponse({ success: true, data: { status: "ready" } });
			}
			if (url.endsWith("/api/v1/patients")) {
				return jsonResponse({
					success: true,
					data: {
						items: [
							{
								id: "patient-001",
								displayName: "张三",
								relationship: "self",
								cardNumberMasked: "******0001",
							},
						],
						total: 1,
					},
				});
			}
			return jsonResponse({
				success: true,
				data: {
					status: url.includes("status=paid") ? "paid" : "unpaid",
					items: [],
					total: 0,
				},
			});
		},
	});

	expect(result.passed).toBe(true);
	expect(result.checks.map((check) => check.name)).toEqual([
		"health-live",
		"health-ready",
		"patients",
		"patient-owner",
		"outpatient-payments-unpaid",
		"outpatient-payments-paid",
	]);
	expect(requests.map((request) => request.url)).toEqual([
		"https://hospital.example.test/health/live",
		"https://hospital.example.test/health/ready",
		"https://hospital.example.test/api/v1/patients",
		"https://hospital.example.test/api/v1/payments/outpatient/records?patientId=patient-001&status=unpaid",
		"https://hospital.example.test/api/v1/payments/outpatient/records?patientId=patient-001&status=paid",
	]);
	expect(
		requests
			.slice(2)
			.every(
				(request) => request.authorization === "Bearer platform-access-token",
			),
	).toBe(true);
});

test("预约历史 smoke 覆盖当前日期前后各 90 天", async () => {
	const requests: string[] = [];
	const result = await runProviderDirectorySmoke({
		baseUrl: "https://hospital.example.test",
		accessToken: "platform-access-token",
		patientId: "patient-001",
		capabilities: ["appointment-records"],
		// UTC 16:30 已经是中国标准时间次日 00:30，用它覆盖日期边界。
		date: new Date("2026-08-14T16:30:00.000Z"),
		fetcher: async (input) => {
			const url = String(input);
			requests.push(url);
			if (url.endsWith("/health/live")) {
				return jsonResponse({ success: true, data: { status: "ok" } });
			}
			if (url.endsWith("/health/ready")) {
				return jsonResponse({ success: true, data: { status: "ready" } });
			}
			if (url.endsWith("/api/v1/patients")) {
				return jsonResponse({
					success: true,
					data: {
						items: [
							{
								id: "patient-001",
								displayName: "张三",
								relationship: "self",
								cardNumberMasked: "******0001",
							},
						],
						total: 1,
					},
				});
			}
			return jsonResponse({
				success: true,
				data: { items: [], total: 0 },
			});
		},
	});

	expect(result.passed).toBe(true);
	const recordsUrl = requests.find((url) =>
		url.includes("/api/v1/appointments/records?"),
	);
	expect(recordsUrl).toBeDefined();
	const query = new URL(recordsUrl ?? "https://hospital.example.test")
		.searchParams;
	expect(query.get("patientId")).toBe("patient-001");
	expect(query.get("startDate")).toBe("2026-05-17");
	expect(query.get("endDate")).toBe("2026-11-13");
});

test("provider directory smoke rejects an outpatient status mismatch", async () => {
	const result = await runProviderDirectorySmoke({
		baseUrl: "https://hospital.example.test",
		accessToken: "platform-access-token",
		patientId: "patient-001",
		capabilities: ["outpatient-payments"],
		fetcher: async (input) => {
			const url = String(input);
			if (url.endsWith("/health/live")) {
				return jsonResponse({ success: true, data: { status: "ok" } });
			}
			if (url.endsWith("/health/ready")) {
				return jsonResponse({ success: true, data: { status: "ready" } });
			}
			if (url.endsWith("/api/v1/patients")) {
				return jsonResponse({
					success: true,
					data: {
						items: [
							{
								id: "patient-001",
								displayName: "张三",
								relationship: "self",
								cardNumberMasked: "******0001",
							},
						],
						total: 1,
					},
				});
			}
			return jsonResponse({
				success: true,
				data: { status: "paid", items: [], total: 0 },
			});
		},
	});

	expect(result.passed).toBe(false);
	expect(result.checks.at(-2)).toEqual({
		name: "outpatient-payments-unpaid",
		status: "failed",
		errorType: "ProviderSmokeRequestError",
		traceId: expect.any(String),
	});
});

test("provider directory smoke refuses a patient outside the current session directory", async () => {
	const requests: string[] = [];
	const result = await runProviderDirectorySmoke({
		baseUrl: "https://hospital.example.test",
		accessToken: "platform-access-token",
		patientId: "patient-not-owned",
		capabilities: ["outpatient-payments"],
		fetcher: async (input) => {
			const url = String(input);
			requests.push(url);
			if (url.endsWith("/health/live")) {
				return jsonResponse({ success: true, data: { status: "ok" } });
			}
			if (url.endsWith("/health/ready")) {
				return jsonResponse({ success: true, data: { status: "ready" } });
			}
			if (url.endsWith("/api/v1/patients")) {
				return jsonResponse({
					success: true,
					data: {
						items: [
							{
								id: "patient-owned",
								displayName: "张三",
								relationship: "self",
								cardNumberMasked: "******0001",
							},
						],
						total: 1,
					},
				});
			}
			throw new Error("provider endpoint must not be called");
		},
	});

	// 归属校验失败后必须短路，不能把未归属患者号继续传给门诊缴费 Provider。
	expect(result.passed).toBe(false);
	expect(result.checks.at(-1)).toEqual({
		name: "patient-owner",
		status: "failed",
		errorType: "ProviderSmokeRequestError",
		traceId: expect.any(String),
	});
	expect(requests).toEqual([
		"https://hospital.example.test/health/live",
		"https://hospital.example.test/health/ready",
		"https://hospital.example.test/api/v1/patients",
	]);
});

test("provider smoke accepts only the platform opaque report id and can verify LIS detail", async () => {
	const requests: string[] = [];
	const result = await runProviderDirectorySmoke({
		baseUrl: "https://hospital.example.test",
		accessToken: "platform-access-token",
		patientId: "internal-patient-001",
		capabilities: ["report-detail"],
		fetcher: async (input) => {
			const url = String(input);
			requests.push(url);
			if (url.endsWith("/health/live")) {
				return jsonResponse({ success: true, data: { status: "ok" } });
			}
			if (url.endsWith("/health/ready")) {
				return jsonResponse({ success: true, data: { status: "ready" } });
			}
			if (url.endsWith("/api/v1/patients")) {
				return jsonResponse({
					success: true,
					data: {
						items: [
							{
								id: "internal-patient-001",
								displayName: "张三",
								relationship: "self",
								cardNumberMasked: "******0001",
							},
						],
						total: 1,
					},
				});
			}
			if (url.includes("/reports?")) {
				return jsonResponse({
					success: true,
					data: {
						items: [
							{
								reportId:
									"report_0123456789abcdef0123456789abcdef0123456789abcdef",
								kind: "laboratory",
								title: "血常规",
								reportedAt: "2026-08-15 10:00:00",
								status: "available",
								hasAttachment: false,
							},
						],
						total: 1,
					},
				});
			}
			return jsonResponse({
				success: true,
				data: {
					reportId: "report_0123456789abcdef0123456789abcdef0123456789abcdef",
					kind: "laboratory",
					title: "血常规",
					reportedAt: "2026-08-15 10:00:00",
					items: [{ name: "白细胞", result: "10.2", flag: "high" }],
					hasAttachment: false,
				},
			});
		},
	});

	expect(result.passed).toBe(true);
	expect(result.checks.map((check) => check.name)).toEqual([
		"health-live",
		"health-ready",
		"patients",
		"patient-owner",
		"reports",
		"report-detail",
	]);
	const detailRequest = requests.find((url) =>
		url.includes("/api/v1/reports/report_"),
	);
	expect(detailRequest).toContain(
		"/api/v1/reports/report_0123456789abcdef0123456789abcdef0123456789abcdef?patientId=internal-patient-001",
	);
});

test("provider directory smoke fails when a platform response contains a forbidden provider field", async () => {
	const result = await runProviderDirectorySmoke({
		baseUrl: "https://hospital.example.test",
		accessToken: "platform-access-token",
		capabilities: ["patients"],
		fetcher: async (input) => {
			const url = String(input);
			if (url.endsWith("/health/live")) {
				return jsonResponse({ success: true, data: { status: "ok" } });
			}
			if (url.endsWith("/health/ready")) {
				return jsonResponse({ success: true, data: { status: "ready" } });
			}
			return jsonResponse({
				success: true,
				data: {
					items: [
						{ id: "internal-patient-001", providerPatientId: "must-not-leak" },
					],
				},
			});
		},
	});

	expect(result.passed).toBe(false);
	expect(result.checks.at(-1)).toEqual({
		name: "patients",
		status: "failed",
		errorType: "ProviderSmokeRequestError",
		traceId: expect.any(String),
	});
});

test("provider directory smoke rejects leaked identity credentials", async () => {
	const result = await runProviderDirectorySmoke({
		baseUrl: "https://hospital.example.test",
		accessToken: "platform-access-token",
		capabilities: ["patients"],
		fetcher: async (input) => {
			const url = String(input);
			if (url.endsWith("/health/live")) {
				return jsonResponse({ success: true, data: { status: "ok" } });
			}
			if (url.endsWith("/health/ready")) {
				return jsonResponse({ success: true, data: { status: "ready" } });
			}
			return jsonResponse({
				success: true,
				data: {
					items: [{ id: "internal-patient-001", openid: "must-not-leak" }],
				},
			});
		},
	});

	expect(result.passed).toBe(false);
	expect(result.checks.at(-1)).toEqual({
		name: "patients",
		status: "failed",
		errorType: "ProviderSmokeRequestError",
		traceId: expect.any(String),
	});
});

test("provider directory smoke rejects leaked schedule provider references", async () => {
	const result = await runProviderDirectorySmoke({
		baseUrl: "https://hospital.example.test",
		accessToken: "platform-access-token",
		capabilities: ["appointment-directory"],
		fetcher: async (input) => {
			const url = String(input);
			if (url.endsWith("/health/live")) {
				return jsonResponse({ success: true, data: { status: "ok" } });
			}
			if (url.endsWith("/health/ready")) {
				return jsonResponse({ success: true, data: { status: "ready" } });
			}
			if (url.includes("/appointments/departments")) {
				return jsonResponse({ success: true, data: { items: [], total: 0 } });
			}
			return jsonResponse({
				success: true,
				data: {
					items: [
						{
							scheduleId: "platform-schedule-001",
							providerScheduleId: "provider-schedule-001",
						},
					],
					total: 1,
				},
			});
		},
	});

	expect(result.passed).toBe(false);
	expect(result.checks.at(-1)).toEqual({
		name: "appointment-schedules",
		status: "failed",
		errorType: "ProviderSmokeRequestError",
		traceId: expect.any(String),
	});
});

test("provider directory smoke does not treat not-ready as a successful health check", async () => {
	const result = await runProviderDirectorySmoke({
		baseUrl: "https://hospital.example.test",
		accessToken: "platform-access-token",
		capabilities: [],
		fetcher: async (input) => {
			const url = String(input);
			if (url.endsWith("/health/live")) {
				return jsonResponse({ success: true, data: { status: "ok" } });
			}
			return jsonResponse({
				success: true,
				data: {
					status: "not_ready",
					dependencies: { database: "unavailable" },
				},
			});
		},
	});

	expect(result.passed).toBe(false);
	expect(result.checks).toEqual([
		{ name: "health-live", status: "passed", traceId: expect.any(String) },
		{
			name: "health-ready",
			status: "failed",
			errorType: "ProviderSmokeRequestError",
			traceId: expect.any(String),
		},
	]);
});

test("provider directory smoke identifies readiness failure in a later sample", async () => {
	let readinessCalls = 0;
	const result = await runProviderDirectorySmoke({
		baseUrl: "https://hospital.example.test",
		accessToken: "platform-access-token",
		capabilities: [],
		readinessSamples: 3,
		readinessIntervalMs: 0,
		fetcher: async (input) => {
			const url = String(input);
			if (url.endsWith("/health/live")) {
				return jsonResponse({ success: true, data: { status: "ok" } });
			}
			if (url.endsWith("/health/ready")) {
				readinessCalls += 1;
				return jsonResponse({
					success: true,
					data: { status: readinessCalls === 2 ? "not_ready" : "ready" },
				});
			}
			throw new Error("provider route must not be called");
		},
	});

	expect(result.passed).toBe(false);
	expect(readinessCalls).toBe(2);
	expect(result.checks.at(-1)).toEqual({
		name: "health-ready",
		status: "failed",
		errorType: "ProviderSmokeRequestError",
		details: ["readiness-sample-2/3"],
		traceId: expect.any(String),
	});
});

test("provider directory smoke rejects public HTTP unless local opt-in is explicit", async () => {
	await expect(
		runProviderDirectorySmoke({
			baseUrl: "http://hospital.example.test",
			accessToken: "platform-access-token",
			capabilities: [],
		}),
	).rejects.toMatchObject({
		name: "ProviderSmokeConfigurationError",
		reason: "base-url-https-required",
	});
});

test("provider directory smoke rejects missing credentials with a safe reason", async () => {
	await expect(
		runProviderDirectorySmoke({
			baseUrl: "https://hospital.example.test",
			accessToken: "",
			capabilities: [],
		}),
	).rejects.toMatchObject({
		name: "ProviderSmokeConfigurationError",
		reason: "access-token-missing",
	});
});

test("provider directory smoke keeps traceId when the platform request fails", async () => {
	const traceIds = [
		"health-live-trace",
		"health-ready-trace",
		"patients-trace",
	];
	const result = await runProviderDirectorySmoke({
		baseUrl: "https://hospital.example.test",
		accessToken: "platform-access-token",
		capabilities: ["patients"],
		traceIdFactory: () => traceIds.shift() ?? "patients-trace",
		fetcher: async (input) => {
			const url = String(input);
			if (url.endsWith("/health/live")) {
				return jsonResponse({ success: true, data: { status: "ok" } });
			}
			if (url.endsWith("/health/ready")) {
				return jsonResponse({ success: true, data: { status: "ready" } });
			}
			throw new Error("simulated network failure");
		},
	});

	expect(result.passed).toBe(false);
	expect(result.checks.at(-1)).toEqual({
		name: "patients",
		status: "failed",
		errorType: "ProviderSmokeRequestError",
		traceId: "patients-trace",
	});
});
