import { expect, test } from "bun:test";
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

test("runtime smoke verifies platform health without auth or provider calls", async () => {
	const requests: Array<{
		url: string;
		method: string;
		authorization: string | null;
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
			return unauthorizedResponse();
		},
	});

	expect(result).toMatchObject({
		passed: true,
		checks: [
			{ name: "health-live", status: "passed" },
			{ name: "health-ready", status: "passed" },
			{ name: "system-ping", status: "passed" },
			{ name: "auth-boundary", status: "passed" },
		],
	});
	expect(requests).toEqual([
		{
			url: "https://hospital.example.test/health/live",
			method: "GET",
			authorization: null,
		},
		{
			url: "https://hospital.example.test/health/ready",
			method: "GET",
			authorization: null,
		},
		{
			url: "https://hospital.example.test/api/v1/system/ping",
			method: "GET",
			authorization: null,
		},
		{
			url: "https://hospital.example.test/api/v1/me",
			method: "GET",
			authorization: null,
		},
		{
			url: "https://hospital.example.test/api/v1/patients",
			method: "GET",
			authorization: null,
		},
		{
			url: "https://hospital.example.test/api/v1/appointments/departments",
			method: "GET",
			authorization: null,
		},
		{
			url: "https://hospital.example.test/api/v1/appointments/records?patientId=runtime-smoke-patient&startDate=2026-01-01&endDate=2026-01-02",
			method: "GET",
			authorization: null,
		},
		{
			url: "https://hospital.example.test/api/v1/reports?patientId=runtime-smoke-patient&startDate=2026-01-01&endDate=2026-01-02",
			method: "GET",
			authorization: null,
		},
		{
			url: "https://hospital.example.test/api/v1/payments/outpatient/records?patientId=runtime-smoke-patient&status=unpaid",
			method: "GET",
			authorization: null,
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
			return unauthorizedResponse();
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
	]);
});

test("runtime smoke fails when a public health path loses no-store", async () => {
	const result = await runApiRuntimeSmoke({
		baseUrl: "https://hospital.example.test",
		fetcher: async (input) => {
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
			return unauthorizedResponse();
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
		fetcher: async (input) => {
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
			return unauthorizedResponse();
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
		fetcher: async (input) => {
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
			return unauthorizedResponse();
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
		fetcher: async (input) => {
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
			return unauthorizedResponse();
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
		fetcher: async (input) => {
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
			return unauthorizedResponse();
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
		fetcher: async (input) => {
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
			return unauthorizedResponse();
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

test("runtime smoke fails when a protected route is not rejected by authentication", async () => {
	const result = await runApiRuntimeSmoke({
		baseUrl: "https://hospital.example.test",
		fetcher: async (input) => {
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
			return unauthorizedResponse();
		},
	});

	expect(result.passed).toBe(false);
	expect(result.checks.at(-1)).toMatchObject({
		name: "auth-boundary",
		status: "failed",
		details: ["me:http-200"],
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
