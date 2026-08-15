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
	expect(
		requests.every(
			(request) => request.authorization === "Bearer platform-access-token",
		),
	).toBe(true);
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
	});
});

test("provider directory smoke rejects public HTTP unless local opt-in is explicit", async () => {
	await expect(
		runProviderDirectorySmoke({
			baseUrl: "http://hospital.example.test",
			accessToken: "platform-access-token",
			capabilities: [],
		}),
	).rejects.toMatchObject({ name: "ProviderSmokeConfigurationError" });
});
