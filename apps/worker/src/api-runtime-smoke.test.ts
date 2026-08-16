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
			return jsonResponse({
				success: true,
				data: { service: "hospital-api", apiVersion: "0.1.0" },
			});
		},
	});

	expect(result).toMatchObject({
		passed: true,
		checks: [
			{ name: "health-live", status: "passed" },
			{ name: "health-ready", status: "passed" },
			{ name: "system-ping", status: "passed" },
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
			return jsonResponse({
				success: true,
				data: { service: "hospital-api", apiVersion: "0.1.0" },
			});
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
			return jsonResponse({
				success: true,
				data: { service: "hospital-api", apiVersion: "0.1.0" },
			});
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
			return jsonResponse({
				success: true,
				data: { service: "hospital-api", apiVersion: "0.1.0" },
			});
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
	const result = await runApiRuntimeSmoke({
		baseUrl: "https://hospital.example.test",
		requireReady: true,
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
			return jsonResponse({
				success: true,
				data: { service: "hospital-api", apiVersion: "0.1.0" },
			});
		},
	});

	expect(result.passed).toBe(false);
	expect(result.checks[1]).toMatchObject({
		name: "health-ready",
		status: "failed",
		details: ["RuntimeSmokeRequestError"],
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
