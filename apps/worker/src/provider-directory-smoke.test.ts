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
		"https://hospital.example.test/api/v2/patients",
		"https://hospital.example.test/api/v2/patients/sync",
	]);
	expect(requests[0]?.authorization).toBeNull();
	expect(requests[1]?.authorization).toBeNull();
	expect(requests[2]?.authorization).toBe("Bearer platform-access-token");
	expect(requests[3]).toMatchObject({
		method: "POST",
		authorization: "Bearer platform-access-token",
		idempotencyKey: expect.stringMatching(/^provider-smoke-/),
	});
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
		traceIdFactory: () => "sync-trace-001",
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
	expect(result.checks.at(-1)).toEqual({
		name: "patient-sync",
		status: "passed",
		itemCount: 1,
		traceId: "sync-trace-001",
	});
	expect(requests.at(-1)).toEqual({
		url: "https://hospital.example.test/api/v1/patients/sync",
		method: "POST",
		idempotencyKey: "provider-smoke-sync-trace-001",
	});
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
		"reports",
		"report-detail",
	]);
	expect(requests.some((url) => url.includes("/api/v1/reports/report_"))).toBe(
		true,
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
		},
	]);
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
