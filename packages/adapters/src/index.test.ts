import { expect, test } from "bun:test";
import {
	AdapterNotConfiguredError,
	createFixtureMedicalInsuranceGateway,
	createNotConfiguredGateways,
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
			{ authCode: "test-code", patientId: "patient-001" },
			context,
		),
	).rejects.toBeInstanceOf(AdapterNotConfiguredError);
});

test("fixture gateway exposes traceable synthetic responses", async () => {
	const gateway = createFixtureMedicalInsuranceGateway();
	const result = await gateway.settle(
		{
			orderId: "order-001",
			authorizationId: "auth-001",
			feeUploadId: "fee-001",
		},
		context,
	);

	expect(result.state).toBe("insurance_settled");
	expect(result.amounts.totalFen).toBe(
		result.amounts.insuranceFen + result.amounts.cashFen,
	);
	expect(result.trace).toEqual({
		provider: "fixture-medical-insurance",
		operation: "6202",
		requestId: "test-trace-001",
		providerOrderId: "fixture-pay-001",
	});

	const queried = await gateway.query({ orderId: "order-001" }, context);
	expect(queried.state).toBe("insurance_settled");
	expect(queried.amounts).toEqual(result.amounts);
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
