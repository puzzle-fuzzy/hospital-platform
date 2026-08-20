import { expect, test } from "bun:test";
import type { AppLogger } from "@hospital/observability";
import { runApiRuntimeSmoke } from "./api-runtime-smoke";

function jsonResponse(
	body: unknown,
	status = 200,
	extraHeaders: HeadersInit = {},
): Response {
	return new Response(JSON.stringify(body), {
		status,
		headers: { "content-type": "application/json", ...extraHeaders },
	});
}

function unauthorizedResponse(): Response {
	return jsonResponse(
		{
			success: false,
			error: {
				code: "unauthorized",
				message: "请先登录后再继续操作",
			},
		},
		401,
	);
}

function notFoundResponse(): Response {
	return jsonResponse(
		{
			success: false,
			error: {
				code: "not-found",
				message: "请求路径不存在",
			},
		},
		404,
	);
}

/** 测试夹具模拟当前服务的两类未登录边界：已注册路由返回 401，关闭路由返回 404。 */
function defaultBoundaryResponse(url: string, method = "GET"): Response {
	const pathname = new URL(url).pathname;
	if (
		(method === "POST" && pathname === "/api/v1/patients") ||
		pathname === "/api/v1/medical-records" ||
		pathname === "/api/v1/medical-records/closed-boundary-visit" ||
		(method === "POST" &&
			pathname === "/api/v1/payments/insurance/authorization") ||
		(method === "POST" && pathname === "/api/v1/appointments") ||
		(method === "POST" && pathname === "/api/v1/appointments/holds") ||
		(method === "POST" &&
			pathname === "/api/v1/appointments/closed-boundary-appointment/cancel") ||
		(method === "POST" && pathname === "/api/v2/patients") ||
		pathname === "/api/v2/medical-records" ||
		pathname === "/api/v2/medical-records/closed-boundary-visit" ||
		(method === "POST" &&
			pathname === "/api/v2/payments/insurance/authorization") ||
		(method === "POST" && pathname === "/api/v2/appointments") ||
		(method === "POST" && pathname === "/api/v2/appointments/holds") ||
		(method === "POST" &&
			pathname === "/api/v2/appointments/closed-boundary-appointment/cancel")
	) {
		return notFoundResponse();
	}
	return unauthorizedResponse();
}

test("runtime smoke verifies platform health without auth or provider calls", async () => {
	const requests: Array<{
		url: string;
		method: string;
		authorization: string | null;
		body: string | null;
	}> = [];
	const result = await runApiRuntimeSmoke({
		baseUrl: "https://hospital.example.test",
		traceIdFactory: () => "runtime-trace-001",
		fetcher: async (input, init) => {
			const url = String(input);
			requests.push({
				url,
				method: init?.method ?? "GET",
				authorization: new Headers(init?.headers).get("authorization"),
				body: typeof init?.body === "string" ? init.body : null,
			});
			if (url.endsWith("/health/live")) {
				return jsonResponse({ success: true, data: { status: "ok" } }, 200, {
					"cache-control": "no-store",
				});
			}
			if (url.endsWith("/health/ready")) {
				return jsonResponse({ success: true, data: { status: "ready" } }, 200, {
					"cache-control": "no-store",
				});
			}
			if (url.endsWith("/system/ping")) {
				return jsonResponse({
					success: true,
					data: { service: "hospital-api", apiVersion: "0.1.0" },
				});
			}
			return defaultBoundaryResponse(url, init?.method ?? "GET");
		},
	});

	expect(result).toMatchObject({
		passed: true,
		checks: [
			{ name: "health-live", status: "passed" },
			{ name: "health-ready", status: "passed" },
			{ name: "system-ping", status: "passed" },
			{ name: "auth-boundary", status: "passed" },
			{ name: "closed-boundary", status: "passed" },
		],
	});
	expect(requests).toEqual([
		{
			url: "https://hospital.example.test/health/live",
			method: "GET",
			authorization: null,
			body: null,
		},
		{
			url: "https://hospital.example.test/health/ready",
			method: "GET",
			authorization: null,
			body: null,
		},
		{
			url: "https://hospital.example.test/api/v1/system/ping",
			method: "GET",
			authorization: null,
			body: null,
		},
		{
			url: "https://hospital.example.test/api/v1/me",
			method: "GET",
			authorization: null,
			body: null,
		},
		{
			url: "https://hospital.example.test/api/v1/patients",
			method: "GET",
			authorization: null,
			body: null,
		},
		{
			url: "https://hospital.example.test/api/v1/appointments/departments",
			method: "GET",
			authorization: null,
			body: null,
		},
		{
			url: "https://hospital.example.test/api/v1/appointments/records?patientId=runtime-smoke-patient&startDate=2026-01-01&endDate=2026-01-02",
			method: "GET",
			authorization: null,
			body: null,
		},
		{
			url: "https://hospital.example.test/api/v1/reports?patientId=runtime-smoke-patient&startDate=2026-01-01&endDate=2026-01-02",
			method: "GET",
			authorization: null,
			body: null,
		},
		{
			url: "https://hospital.example.test/api/v1/payments/outpatient/records?patientId=runtime-smoke-patient&status=unpaid",
			method: "GET",
			authorization: null,
			body: null,
		},
		{
			url: "https://hospital.example.test/api/v1/patients",
			method: "POST",
			authorization: null,
			body: "{}",
		},
		{
			url: "https://hospital.example.test/api/v1/medical-records",
			method: "GET",
			authorization: null,
			body: null,
		},
		{
			url: "https://hospital.example.test/api/v1/medical-records/closed-boundary-visit",
			method: "GET",
			authorization: null,
			body: null,
		},
		{
			url: "https://hospital.example.test/api/v1/payments/insurance/authorization",
			method: "POST",
			authorization: null,
			body: "{}",
		},
		{
			url: "https://hospital.example.test/api/v1/appointments",
			method: "POST",
			authorization: null,
			body: "{}",
		},
		{
			url: "https://hospital.example.test/api/v1/appointments/holds",
			method: "POST",
			authorization: null,
			body: "{}",
		},
		{
			url: "https://hospital.example.test/api/v1/appointments/closed-boundary-appointment/cancel",
			method: "POST",
			authorization: null,
			body: "{}",
		},
	]);
});

test("runtime smoke uses the public v2 prefix when explicitly requested", async () => {
	const requests: Array<{ url: string; authorization: string | null }> = [];
	const result = await runApiRuntimeSmoke({
		baseUrl: "https://hospital.example.test",
		apiPrefix: "/api/v2",
		traceIdFactory: () => "public-runtime-trace-001",
		fetcher: async (input, init) => {
			const url = String(input);
			requests.push({
				url,
				authorization: new Headers(init?.headers).get("authorization"),
			});
			if (url.endsWith("/api/v2/health/live")) {
				return jsonResponse({ success: true, data: { status: "ok" } }, 200, {
					"cache-control": "no-store",
				});
			}
			if (url.endsWith("/api/v2/health/ready")) {
				return jsonResponse({ success: true, data: { status: "ready" } }, 200, {
					"cache-control": "no-store",
				});
			}
			if (url.endsWith("/system/ping")) {
				return jsonResponse({
					success: true,
					data: { service: "hospital-api", apiVersion: "0.1.0" },
				});
			}
			return defaultBoundaryResponse(url, init?.method ?? "GET");
		},
	});

	expect(result.passed).toBe(true);
	expect(requests).toEqual([
		{
			url: "https://hospital.example.test/api/v2/health/live",
			authorization: null,
		},
		{
			url: "https://hospital.example.test/api/v2/health/ready",
			authorization: null,
		},
		{
			url: "https://hospital.example.test/api/v2/system/ping",
			authorization: null,
		},
		{
			url: "https://hospital.example.test/api/v2/me",
			authorization: null,
		},
		{
			url: "https://hospital.example.test/api/v2/patients",
			authorization: null,
		},
		{
			url: "https://hospital.example.test/api/v2/appointments/departments",
			authorization: null,
		},
		{
			url: "https://hospital.example.test/api/v2/appointments/records?patientId=runtime-smoke-patient&startDate=2026-01-01&endDate=2026-01-02",
			authorization: null,
		},
		{
			url: "https://hospital.example.test/api/v2/reports?patientId=runtime-smoke-patient&startDate=2026-01-01&endDate=2026-01-02",
			authorization: null,
		},
		{
			url: "https://hospital.example.test/api/v2/payments/outpatient/records?patientId=runtime-smoke-patient&status=unpaid",
			authorization: null,
		},
		{
			url: "https://hospital.example.test/api/v2/patients",
			authorization: null,
		},
		{
			url: "https://hospital.example.test/api/v2/medical-records",
			authorization: null,
		},
		{
			url: "https://hospital.example.test/api/v2/medical-records/closed-boundary-visit",
			authorization: null,
		},
		{
			url: "https://hospital.example.test/api/v2/payments/insurance/authorization",
			authorization: null,
		},
		{
			url: "https://hospital.example.test/api/v2/appointments",
			authorization: null,
		},
		{
			url: "https://hospital.example.test/api/v2/appointments/holds",
			authorization: null,
		},
		{
			url: "https://hospital.example.test/api/v2/appointments/closed-boundary-appointment/cancel",
			authorization: null,
		},
	]);
});

test("runtime smoke fails when a public health path loses no-store", async () => {
	const result = await runApiRuntimeSmoke({
		baseUrl: "https://hospital.example.test",
		fetcher: async (input, init) => {
			const url = String(input);
			if (url.endsWith("/health/live")) {
				return jsonResponse({ success: true, data: { status: "ok" } });
			}
			if (url.endsWith("/health/ready")) {
				return jsonResponse({ success: true, data: { status: "ready" } }, 200, {
					"cache-control": "no-store",
				});
			}
			if (url.endsWith("/system/ping")) {
				return jsonResponse({
					success: true,
					data: { service: "hospital-api", apiVersion: "0.1.0" },
				});
			}
			return defaultBoundaryResponse(url, init?.method ?? "GET");
		},
	});

	expect(result.passed).toBe(false);
	expect(result.checks[0]).toMatchObject({
		name: "health-live",
		status: "failed",
		details: ["RuntimeSmokeRequestError"],
	});
});

test("runtime smoke reports not-ready as a warning in observation mode", async () => {
	const result = await runApiRuntimeSmoke({
		baseUrl: "https://hospital.example.test",
		fetcher: async (input, init) => {
			const url = String(input);
			if (url.endsWith("/health/live")) {
				return jsonResponse({ success: true, data: { status: "ok" } }, 200, {
					"cache-control": "no-store",
				});
			}
			if (url.endsWith("/health/ready")) {
				return jsonResponse(
					{ success: true, data: { status: "not_ready" } },
					200,
					{ "cache-control": "no-store" },
				);
			}
			if (url.endsWith("/system/ping")) {
				return jsonResponse({
					success: true,
					data: { service: "hospital-api", apiVersion: "0.1.0" },
				});
			}
			return defaultBoundaryResponse(url, init?.method ?? "GET");
		},
	});

	expect(result.passed).toBe(true);
	expect(result.checks[1]).toMatchObject({
		name: "health-ready",
		status: "warning",
		details: ["not_ready"],
	});
});

test("runtime smoke requires ready for release acceptance", async () => {
	const traceIds = [
		"live-trace-001",
		"ready-trace-001",
		"ping-trace-001",
		"auth-trace-001",
	];
	const result = await runApiRuntimeSmoke({
		baseUrl: "https://hospital.example.test",
		requireReady: true,
		traceIdFactory: () => traceIds.shift() ?? "fallback-trace",
		fetcher: async (input, init) => {
			const url = String(input);
			if (url.endsWith("/health/live")) {
				return jsonResponse({ success: true, data: { status: "ok" } }, 200, {
					"cache-control": "no-store",
				});
			}
			if (url.endsWith("/health/ready")) {
				return jsonResponse(
					{ success: true, data: { status: "not_ready" } },
					200,
					{ "cache-control": "no-store" },
				);
			}
			if (url.endsWith("/system/ping")) {
				return jsonResponse({
					success: true,
					data: { service: "hospital-api", apiVersion: "0.1.0" },
				});
			}
			return defaultBoundaryResponse(url, init?.method ?? "GET");
		},
	});

	expect(result.passed).toBe(false);
	expect(result.checks[1]).toMatchObject({
		name: "health-ready",
		status: "failed",
		details: ["RuntimeSmokeRequestError"],
		traceId: "ready-trace-001",
	});
});

test("runtime smoke fails when readiness becomes unavailable inside the stability window", async () => {
	let readinessCalls = 0;
	const result = await runApiRuntimeSmoke({
		baseUrl: "https://hospital.example.test",
		requireReady: true,
		readinessSamples: 3,
		readinessIntervalMs: 0,
		fetcher: async (input, init) => {
			const url = String(input);
			if (url.endsWith("/health/live")) {
				return jsonResponse({ success: true, data: { status: "ok" } }, 200, {
					"cache-control": "no-store",
				});
			}
			if (url.endsWith("/health/ready")) {
				readinessCalls += 1;
				return jsonResponse(
					{
						success: true,
						data: { status: readinessCalls === 2 ? "not_ready" : "ready" },
					},
					200,
					{ "cache-control": "no-store" },
				);
			}
			if (url.endsWith("/system/ping")) {
				return jsonResponse({
					success: true,
					data: { service: "hospital-api", apiVersion: "0.1.0" },
				});
			}
			return defaultBoundaryResponse(url, init?.method ?? "GET");
		},
	});

	expect(result.passed).toBe(false);
	expect(readinessCalls).toBe(2);
	expect(result.checks[1]).toMatchObject({
		name: "health-ready",
		status: "failed",
		details: ["RuntimeSmokeRequestError", "readiness-sample-2/3"],
	});
});

test("runtime smoke reports an intermittent not-ready sample instead of hiding it", async () => {
	let readinessCalls = 0;
	const result = await runApiRuntimeSmoke({
		baseUrl: "https://hospital.example.test",
		readinessSamples: 2,
		readinessIntervalMs: 0,
		fetcher: async (input, init) => {
			const url = String(input);
			if (url.endsWith("/health/live")) {
				return jsonResponse({ success: true, data: { status: "ok" } }, 200, {
					"cache-control": "no-store",
				});
			}
			if (url.endsWith("/health/ready")) {
				readinessCalls += 1;
				return jsonResponse(
					{
						success: true,
						data: { status: readinessCalls === 1 ? "not_ready" : "ready" },
					},
					200,
					{ "cache-control": "no-store" },
				);
			}
			if (url.endsWith("/system/ping")) {
				return jsonResponse({
					success: true,
					data: { service: "hospital-api", apiVersion: "0.1.0" },
				});
			}
			return defaultBoundaryResponse(url, init?.method ?? "GET");
		},
	});

	expect(result.passed).toBe(true);
	expect(result.checks[1]).toMatchObject({
		name: "health-ready",
		status: "warning",
		details: ["not_ready", "samples=2", "not_ready_samples=1"],
	});
});

test("runtime smoke keeps traceId when a platform request fails", async () => {
	const result = await runApiRuntimeSmoke({
		baseUrl: "https://hospital.example.test",
		traceIdFactory: () => "transport-trace-001",
		fetcher: async (input, init) => {
			const url = String(input);
			if (url.endsWith("/health/live")) {
				throw new Error("connection reset by peer");
			}
			if (url.endsWith("/health/ready")) {
				return jsonResponse({ success: true, data: { status: "ready" } }, 200, {
					"cache-control": "no-store",
				});
			}
			if (url.endsWith("/system/ping")) {
				return jsonResponse({
					success: true,
					data: { service: "hospital-api", apiVersion: "0.1.0" },
				});
			}
			return defaultBoundaryResponse(url, init?.method ?? "GET");
		},
	});

	expect(result.passed).toBe(false);
	expect(result.checks[0]).toMatchObject({
		name: "health-live",
		status: "failed",
		details: ["RuntimeSmokeRequestError"],
		statusCode: 0,
		traceId: "transport-trace-001",
	});
});

test("runtime smoke never logs the raw transport error message", async () => {
	const errorLogs: unknown[] = [];
	const logger = {
		info: () => undefined,
		error: (...arguments_: unknown[]) => errorLogs.push(arguments_),
	} as unknown as AppLogger;
	const result = await runApiRuntimeSmoke({
		baseUrl: "https://hospital.example.test",
		logger,
		fetcher: async (input, init) => {
			const url = String(input);
			if (url.endsWith("/health/live")) {
				throw new Error(
					"mysql://secret-user:secret-password/runtime-raw-message",
				);
			}
			if (url.endsWith("/health/ready")) {
				return jsonResponse({ success: true, data: { status: "ready" } }, 200, {
					"cache-control": "no-store",
				});
			}
			if (url.endsWith("/system/ping")) {
				return jsonResponse({
					success: true,
					data: { service: "hospital-api", apiVersion: "0.1.0" },
				});
			}
			return defaultBoundaryResponse(url, init?.method ?? "GET");
		},
	});

	expect(result.passed).toBe(false);
	const serializedLogs = JSON.stringify(errorLogs);
	expect(serializedLogs).not.toContain("secret-password");
	expect(serializedLogs).not.toContain("runtime-raw-message");
	expect(serializedLogs).toContain("RuntimeSmokeRequestError");
});

test("runtime smoke fails when a protected route is not rejected by authentication", async () => {
	const result = await runApiRuntimeSmoke({
		baseUrl: "https://hospital.example.test",
		fetcher: async (input, init) => {
			const url = String(input);
			if (url.endsWith("/health/live")) {
				return jsonResponse({ success: true, data: { status: "ok" } }, 200, {
					"cache-control": "no-store",
				});
			}
			if (url.endsWith("/health/ready")) {
				return jsonResponse({ success: true, data: { status: "ready" } }, 200, {
					"cache-control": "no-store",
				});
			}
			if (url.endsWith("/system/ping")) {
				return jsonResponse({
					success: true,
					data: { service: "hospital-api", apiVersion: "0.1.0" },
				});
			}
			if (url.endsWith("/me")) {
				return jsonResponse({
					success: true,
					data: { items: [], total: 0 },
				});
			}
			return defaultBoundaryResponse(url, init?.method ?? "GET");
		},
	});

	expect(result.passed).toBe(false);
	expect(
		result.checks.find((check) => check.name === "auth-boundary"),
	).toMatchObject({
		name: "auth-boundary",
		status: "failed",
		details: ["me:http-200"],
	});
});

test("runtime smoke fails when a closed route is registered", async () => {
	const result = await runApiRuntimeSmoke({
		baseUrl: "https://hospital.example.test",
		fetcher: async (input, init) => {
			const url = String(input);
			if (url.endsWith("/health/live")) {
				return jsonResponse({ success: true, data: { status: "ok" } }, 200, {
					"cache-control": "no-store",
				});
			}
			if (url.endsWith("/health/ready")) {
				return jsonResponse({ success: true, data: { status: "ready" } }, 200, {
					"cache-control": "no-store",
				});
			}
			if (url.endsWith("/system/ping")) {
				return jsonResponse({
					success: true,
					data: { service: "hospital-api", apiVersion: "0.1.0" },
				});
			}
			if (
				url.endsWith("/api/v1/patients") &&
				(init?.method ?? "GET") === "POST"
			) {
				return unauthorizedResponse();
			}
			if (
				url.endsWith("/api/v1/medical-records") &&
				(init?.method ?? "GET") === "GET"
			) {
				return jsonResponse(
					{
						success: false,
						error: {
							code: "upstream-not-found",
							message: "路径由代理层拦截",
						},
					},
					404,
				);
			}
			return defaultBoundaryResponse(url, init?.method ?? "GET");
		},
	});

	expect(result.passed).toBe(false);
	expect(
		result.checks.find((check) => check.name === "closed-boundary"),
	).toMatchObject({
		name: "closed-boundary",
		status: "failed",
		details: ["patient-create:http-401", "medical-records:error-code"],
	});
});

test("runtime smoke rejects public HTTP and URL credentials", async () => {
	await expect(
		runApiRuntimeSmoke({
			baseUrl: "http://hospital.example.test",
		}),
	).rejects.toMatchObject({ name: "RuntimeSmokeConfigurationError" });
	await expect(
		runApiRuntimeSmoke({
			baseUrl: "https://user:password@hospital.example.test",
		}),
	).rejects.toMatchObject({ name: "RuntimeSmokeConfigurationError" });
});
