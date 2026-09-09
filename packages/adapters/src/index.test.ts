import { expect, test } from "bun:test";
import {
	AdapterNotConfiguredError,
	createFixtureMedicalInsuranceGateway,
	createNotConfiguredGateways,
	type ProviderRequestLogger,
	requestJson,
} from "./index";

const context = {
	traceId: "test-trace-001",
	idempotencyKey: "test-idempotency-001",
};

test("not-configured gateways fail closed instead of returning fake success", async () => {
	const gateways = createNotConfiguredGateways();

	await expect(
		gateways.medicalInsurance.authorize(
			{
				authCode: "test-code",
				patientId: "patient-001",
				ownerUserId: "owner-001",
				orderId: "order-001",
				providerSubject: "openid-001",
				patient: {
					providerPatientId: "provider-patient-001",
					name: "张三",
					cardNo: "card-001",
					idNo: "id-001",
					phone: "13800000000",
				},
			},
			context,
		),
	).rejects.toBeInstanceOf(AdapterNotConfiguredError);
});

test("fixture gateway exposes traceable synthetic responses", async () => {
	const gateway = createFixtureMedicalInsuranceGateway();
	const result = await gateway.settle(
		{
			orderId: "order-001",
			ownerUserId: "owner-001",
			authorizationId: "auth-001",
			feeUploadId: "fee-001",
			mdtrtId: "mdtrt-001",
			acctUsedFlag: "",
		},
		context,
	);

	expect(result.state).toBe("awaiting_confirmation");
	expect(result.amounts.totalFen).toBe(
		result.amounts.personalAccountFen +
			result.amounts.fundFen +
			result.amounts.cashFen,
	);
	expect(result.trace).toEqual({
		provider: "fixture-medical-insurance",
		operation: "6202",
		requestId: "test-trace-001",
		providerOrderId: "fixture-pay-001",
	});

	const queried = await gateway.query(
		{ orderId: "order-001", ownerUserId: "owner-001" },
		context,
	);
	expect(queried.state).toBe("awaiting_confirmation");
	expect(queried.amounts).toEqual({
		totalFen: result.amounts.totalFen,
		insuranceFen: result.amounts.personalAccountFen + result.amounts.fundFen,
		cashFen: result.amounts.cashFen,
	});
});

test("provider HTTP boundary adds trace and idempotency headers", async () => {
	let captured: RequestInit | undefined;
	const response = await requestJson<{ ok: true }>(
		{
			provider: "medical-insurance",
			operation: "6201",
			url: "https://provider.invalid/6201",
			method: "POST",
			context,
			body: { orderId: "order-001" },
		},
		async (_input, init) => {
			captured = init;
			return new Response(JSON.stringify({ ok: true }), {
				status: 200,
				headers: { "x-request-id": "provider-request-001" },
			});
		},
	);

	const headers = new Headers(captured?.headers);
	expect(headers.get("x-request-id")).toBe("test-trace-001");
	expect(headers.get("idempotency-key")).toBe("test-idempotency-001");
	expect(response).toEqual({
		data: { ok: true },
		statusCode: 200,
		requestId: "provider-request-001",
	});
});

test("provider HTTP boundary records exact business codes and raw responses", async () => {
	const previousRawLogging = Bun.env.PROVIDER_RAW_LOGGING;
	const logs: Array<Record<string, unknown>> = [];
	const logger: ProviderRequestLogger = {
		info(bindings) {
			logs.push(bindings as Record<string, unknown>);
		},
		warn(bindings) {
			logs.push(bindings as Record<string, unknown>);
		},
		error(bindings) {
			logs.push(bindings as Record<string, unknown>);
		},
	};
	Bun.env.PROVIDER_RAW_LOGGING = "true";

	try {
		await requestJson(
			{
				provider: "yunhealth",
				operation: "registration-self-pay.2.6.65.2.plugin",
				url: "https://provider.invalid/pre-order",
				method: "POST",
				context,
				body: { orderId: "order-001" },
				captureRawBody: true,
				logger,
			},
			async () =>
				new Response(
					JSON.stringify({
						success: false,
						code: "trade-payment@0008",
						message: "操作失败，请勿重复提交或操作过于频繁！",
						data: null,
					}),
					{ status: 200, headers: { "x-request-id": "provider-response-001" } },
				),
		);

		const observed = logs.find(
			(entry) => entry.event === "provider.response.observed",
		);
		expect(observed).toMatchObject({
			providerResponseBusinessSuccess: false,
			providerResponseCode: "trade-payment@0008",
			providerResponseBodyByteLength: expect.any(Number),
			providerResponseBodySha256: expect.any(String),
		});
		const raw = logs.find((entry) => entry.event === "provider.response.raw");
		expect(raw).toMatchObject({
			providerResponseBodyText: expect.stringContaining("trade-payment@0008"),
			providerResponseBodyTextChunkIndex: 0,
			providerResponseBodyTextChunkCount: 1,
		});
	} finally {
		if (previousRawLogging === undefined) {
			delete Bun.env.PROVIDER_RAW_LOGGING;
		} else {
			Bun.env.PROVIDER_RAW_LOGGING = previousRawLogging;
		}
	}
});

test("provider raw response chunks stay journald-queryable and preserve unsafe unicode", async () => {
	const previousRawLogging = Bun.env.PROVIDER_RAW_LOGGING;
	const logs: Array<Record<string, unknown>> = [];
	const logger: ProviderRequestLogger = {
		info(bindings) {
			logs.push(bindings as Record<string, unknown>);
		},
		warn(bindings) {
			logs.push(bindings as Record<string, unknown>);
		},
		error(bindings) {
			logs.push(bindings as Record<string, unknown>);
		},
	};
	Bun.env.PROVIDER_RAW_LOGGING = "true";
	const rawBody = JSON.stringify({
		success: false,
		code: "360053",
		message: `\u0093${"医保外部服务返回".repeat(900)}\u2028`,
	});

	try {
		await requestJson(
			{
				provider: "medical-insurance",
				operation: "6201",
				url: "https://provider.invalid/6201",
				method: "POST",
				context,
				body: { orderId: "order-001" },
				logger,
			},
			async () => new Response(rawBody, { status: 200 }),
		);

		const rawChunks = logs
			.filter((entry) => entry.event === "provider.response.raw")
			.sort(
				(left, right) =>
					Number(left.providerResponseBodyTextChunkIndex) -
					Number(right.providerResponseBodyTextChunkIndex),
			);
		expect(rawChunks.length).toBeGreaterThan(1);
		for (const [index, entry] of rawChunks.entries()) {
			expect(entry.providerResponseBodyTextEncoding).toBe("json-string-v1");
			expect(entry.providerResponseBodyTextChunkIndex).toBe(index);
			expect(entry.providerResponseBodyTextChunkCount).toBe(rawChunks.length);
			const serialized = JSON.stringify(entry);
			expect(new TextEncoder().encode(serialized).byteLength).toBeLessThan(
				4_096,
			);
			expect(serialized).not.toMatch(
				/[\p{Cc}\p{Cf}\p{Cs}\p{Co}\p{Cn}\p{Zl}\p{Zp}]/u,
			);
		}

		const encoded = rawChunks
			.map((entry) => String(entry.providerResponseBodyText ?? ""))
			.join("");
		expect(JSON.parse(encoded)).toBe(rawBody);
		expect(rawChunks[0]).toMatchObject({
			providerResponseBodyTextByteLength: new TextEncoder().encode(rawBody)
				.byteLength,
			providerResponseBodyTextSha256: expect.any(String),
		});
	} finally {
		if (previousRawLogging === undefined) {
			delete Bun.env.PROVIDER_RAW_LOGGING;
		} else {
			Bun.env.PROVIDER_RAW_LOGGING = previousRawLogging;
		}
	}
});

test("provider HTTP boundary classifies upstream failures as retryable", async () => {
	await expect(
		requestJson(
			{
				provider: "medical-insurance",
				operation: "6202",
				url: "https://provider.invalid/6202",
				method: "POST",
				context,
			},
			async () => new Response("upstream unavailable", { status: 503 }),
		),
	).rejects.toMatchObject({
		name: "ProviderRequestError",
		statusCode: 503,
		retryable: true,
		failureStage: "http",
	});
});

test("provider HTTP boundary marks TLS and network failures as transport failures", async () => {
	await expect(
		requestJson(
			{
				provider: "zhongyang",
				operation: "appointment-records",
				url: "https://provider.invalid/appointment-records",
				method: "GET",
				context,
			},
			async () => {
				throw new Error("certificate has expired");
			},
		),
	).rejects.toMatchObject({
		name: "ProviderRequestError",
		retryable: true,
		failureStage: "transport",
		requestId: context.traceId,
		statusCode: undefined,
	});
});

test("provider HTTP boundary rejects unusable response request ids without losing trace correlation", async () => {
	await expect(
		requestJson(
			{
				provider: "medical-insurance",
				operation: "6201",
				url: "https://provider.invalid/6201",
				method: "POST",
				context,
			},
			async () =>
				new Response("upstream unavailable", {
					status: 503,
					headers: { "x-request-id": "   " },
				}),
		),
	).rejects.toMatchObject({
		name: "ProviderRequestError",
		requestId: context.traceId,
		statusCode: 503,
	});
});

test("already-aborted provider calls fail without invoking fetch", async () => {
	const controller = new AbortController();
	controller.abort();
	let fetchCalled = false;

	await expect(
		requestJson(
			{
				provider: "wechat-pay",
				operation: "jsapi-prepay",
				url: "https://provider.invalid/prepay",
				method: "POST",
				context: { ...context, signal: controller.signal },
			},
			async () => {
				fetchCalled = true;
				return new Response("{}", { status: 200 });
			},
		),
	).rejects.toMatchObject({
		name: "ProviderRequestError",
		retryable: true,
	});

	expect(fetchCalled).toBe(false);
});
