import { expect, test } from "bun:test";
import { createHash, createHmac } from "node:crypto";
import {
	type MedicalInsuranceRefundPayload,
	stringifyJsonPreservingLargeIntegers,
} from "@hospital/contracts";
import type { WechatRefund } from "@hospital/domain";
import type { AppLogger } from "@hospital/observability";
import { Elysia } from "elysia";
import { errorHandlerPlugin } from "../../plugins/error-handler";
import { requestContextPlugin } from "../../plugins/request-context";
import { hisMedicalInsuranceRefundModule, hisRefundSignature } from "./refunds";

const token = "his-token-test";
const hmacSecret = "his-hmac-secret-test";
const now = 1_758_000_000_000;

function createSecurityStore() {
	const nonces = new Set<string>();
	let count = 0;
	return {
		reserveNonce(nonce: string) {
			if (nonces.has(nonce)) return Promise.resolve(false);
			nonces.add(nonce);
			return Promise.resolve(true);
		},
		incrementRateLimit() {
			count += 1;
			return Promise.resolve(count);
		},
	};
}

function requestFor(
	method: "POST" | "GET",
	path: string,
	body: unknown,
	nonce: string,
): Request {
	const timestamp = String(Math.floor(now / 1000));
	const requestId = "his-test-request-001";
	const signature = hisRefundSignature({
		method,
		path,
		timestamp,
		nonce,
		requestId,
		body,
		hmacSecret,
	});
	return new Request(`http://localhost/api/v1${path}`, {
		method,
		headers: {
			"content-type": "application/json",
			"x-real-ip": "124.164.248.83",
			"x-his-refund-token": token,
			"x-his-timestamp": timestamp,
			"x-his-nonce": nonce,
			"x-his-signature": signature,
			"x-request-id": requestId,
		},
		...(method === "POST"
			? { body: stringifyJsonPreservingLargeIntegers(body) }
			: {}),
	});
}

test("HIS refund route verifies source, signature and reserves nonce", async () => {
	const security = createSecurityStore();
	const calls: unknown[] = [];
	const service = {
		async requestFullRefundByOrder(
			input: unknown,
		): Promise<MedicalInsuranceRefundPayload["data"]> {
			calls.push(input);
			return {
				orderId: "order-1",
				refundNo: "refund-1",
				status: "succeeded",
				medicalStatus: "success",
				wechatStatus: "success",
				amounts: {
					totalFen: 100,
					cashFen: 40,
					personalAccountFen: 0,
					fundFen: 60,
				},
			};
		},
		async query() {
			return undefined;
		},
	};
	const app = new Elysia()
		.use(requestContextPlugin())
		.use(errorHandlerPlugin())
		.group("/api/v1", (api) =>
			api.use(
				hisMedicalInsuranceRefundModule(service, {
					token,
					hmacSecret,
					security,
					now: () => now,
				}),
			),
		);

	const response = await app.handle(
		requestFor(
			"POST",
			"/his/medical-insurance-refunds",
			{ orderId: "order-1", reason: "test" },
			"nonce-000000000001",
		),
	);
	const payload = (await response.json()) as { data: { status: string } };
	expect(response.status).toBe(200);
	expect(payload.data.status).toBe("succeeded");
	expect(calls).toHaveLength(1);
	expect(calls[0]).toMatchObject({
		orderId: "order-1",
		operatorRef: "his-refund",
		context: { traceId: "his-test-request-001" },
	});
});

const paymentReferencePath =
	"/his/wechat-leg-refunds/by-third-part-pay-record-id";

function rawReferenceRequest(
	body: string,
	nonce: string,
	canonicalBody = body,
): Request {
	const timestamp = String(Math.floor(now / 1000));
	const requestId = "his-reference-request-001";
	// 独立按实际十进制文本签名，避免测试也先把 19 位关联号转成 number。
	const bodyDigest = createHash("sha256").update(canonicalBody).digest("hex");
	const signature = createHmac("sha256", hmacSecret)
		.update(
			[
				"POST",
				paymentReferencePath,
				timestamp,
				nonce,
				requestId,
				bodyDigest,
			].join("\n"),
		)
		.digest("hex");
	return new Request(`http://localhost/api/v1${paymentReferencePath}`, {
		method: "POST",
		headers: {
			"content-type": "application/json",
			"x-real-ip": "124.164.248.83",
			"x-his-refund-token": token,
			"x-his-timestamp": timestamp,
			"x-his-nonce": nonce,
			"x-his-signature": signature,
			"x-request-id": requestId,
		},
		body,
	});
}

function paymentReferenceFixture(
	options: { found?: boolean; configured?: boolean } = {},
) {
	const resolved: string[] = [];
	const refunds: Array<{ input: unknown; context: unknown }> = [];
	const result: WechatRefund = {
		refundRecordId: "refund-reference-1",
		merchantRefundNo: "RFHIS-reference-1",
		idempotencyKey: "his-medical-wechat-leg:order-reference-1",
		source: "medical_insurance",
		sourceOrderId: "order-reference-1",
		outTradeNo: "original-wechat-cash-1",
		totalFen: 40,
		refundFen: 40,
		reason: null,
		status: "processing",
		providerStatus: "PROCESSING",
		providerRefundId: null,
		providerTransactionId: null,
		providerRequestId: null,
		successTime: null,
		lastErrorCode: null,
		version: 1,
		createdAt: new Date(now).toISOString(),
		updatedAt: new Date(now).toISOString(),
	};
	const app = new Elysia({ normalize: false })
		.use(requestContextPlugin())
		.use(errorHandlerPlugin())
		.group("/api/v1", (api) =>
			api.use(
				hisMedicalInsuranceRefundModule(
					{
						async requestFullRefundByOrder() {
							throw new Error(
								"cash reference must not request aggregate refund",
							);
						},
						async query() {
							return undefined;
						},
					},
					{
						token,
						hmacSecret,
						security: createSecurityStore(),
						now: () => now,
						...(options.configured === false
							? {}
							: {
									async resolvePaymentReference(referenceId: string) {
										resolved.push(referenceId);
										return options.found === false
											? undefined
											: {
													medicalOrderId: "order-reference-1",
													paymentScopeId: "cash-component-1",
													source: "component" as const,
												};
									},
								}),
					},
					{
						wechat: {
							async requestMedicalInsuranceCashByOrder(input, context) {
								refunds.push({ input, context });
								return result;
							},
							async requestMedicalInsuranceCashByOutTradeNo() {
								throw new Error("reference must resolve the original order");
							},
							async query() {
								return result;
							},
						},
					},
				),
			),
		);
	return { app, resolved, refunds };
}

test.each(["1952638941030000004", "9223372036854775807"])(
	"HIS cash reference preserves raw 19 digit JSON integer %s and its HMAC",
	async (referenceId) => {
		const fixture = paymentReferenceFixture();
		const response = await fixture.app.handle(
			rawReferenceRequest(
				`{"reason":"HIS现金退费","thirdPartPayRecordId":${referenceId}}`,
				"nonce-reference-raw-0001",
			),
		);
		expect(response.status).toBe(200);
		expect(fixture.resolved).toEqual([referenceId]);
		expect(fixture.refunds).toEqual([
			{
				input: { orderId: "order-reference-1", reason: "HIS现金退费" },
				context: expect.objectContaining({
					traceId: "his-reference-request-001",
				}),
			},
		]);
	},
);

test("HIS cash reference accepts numeric strings without conflating their signature with numbers", async () => {
	const fixture = paymentReferenceFixture();
	const referenceId = "1952638941030000004";
	const body = `{"thirdPartPayRecordId":"${referenceId}"}`;
	const invalid = await fixture.app.handle(
		rawReferenceRequest(
			body,
			"nonce-reference-string-1",
			`{"thirdPartPayRecordId":${referenceId}}`,
		),
	);
	expect(invalid.status).toBe(401);
	expect(fixture.resolved).toEqual([]);
	const valid = await fixture.app.handle(
		rawReferenceRequest(body, "nonce-reference-string-2"),
	);
	expect(valid.status).toBe(200);
	expect(fixture.resolved).toEqual([referenceId]);
});

test.each([
	"9223372036854775808",
	"12345678901234567890",
	"0",
	"-1",
	"1.0",
	"1e3",
	"1.952638941030000004e18",
	'"01"',
	'"1e3"',
	'"19526389410300000040"',
])(
	"HIS cash reference rejects noncanonical or out of range value %s",
	async (value) => {
		const fixture = paymentReferenceFixture();
		const response = await fixture.app.handle(
			rawReferenceRequest(
				`{"thirdPartPayRecordId":${value}}`,
				"nonce-reference-invalid-1",
			),
		);
		expect([400, 422]).toContain(response.status);
		expect(fixture.resolved).toEqual([]);
		expect(fixture.refunds).toEqual([]);
	},
);

test("HIS cash reference authenticates before resolving and returns 404 for unknown or unconfirmed mapping", async () => {
	const fixture = paymentReferenceFixture({ found: false });
	const unauthorized = rawReferenceRequest(
		'{"thirdPartPayRecordId":1952638941030000004}',
		"nonce-reference-unknown-1",
	);
	unauthorized.headers.set("x-his-refund-token", "wrong-token");
	expect((await fixture.app.handle(unauthorized)).status).toBe(401);
	expect(fixture.resolved).toEqual([]);
	const unknown = await fixture.app.handle(
		rawReferenceRequest(
			'{"thirdPartPayRecordId":1952638941030000004}',
			"nonce-reference-unknown-2",
		),
	);
	expect(unknown.status).toBe(404);
	expect(fixture.refunds).toEqual([]);
});

test("HIS cash reference fails closed without a resolver and rejects caller supplied refund amounts", async () => {
	const fixture = paymentReferenceFixture({ configured: false });
	const response = await fixture.app.handle(
		requestFor(
			"POST",
			paymentReferencePath,
			{ thirdPartPayRecordId: 123n },
			"nonce-reference-no-dep-1",
		),
	);
	expect(response.status).toBe(503);
	const configured = paymentReferenceFixture();
	const amount = await configured.app.handle(
		requestFor(
			"POST",
			paymentReferencePath,
			{ thirdPartPayRecordId: 123n, refundFen: 1 },
			"nonce-reference-amount-1",
		),
	);
	expect([400, 422]).toContain(amount.status);
	expect(configured.refunds).toEqual([]);
});

test("HIS refund route rejects a replayed nonce before calling refund service", async () => {
	const security = createSecurityStore();
	let calls = 0;
	const service = {
		async requestFullRefundByOrder(): Promise<
			MedicalInsuranceRefundPayload["data"]
		> {
			calls += 1;
			return {
				orderId: "order-1",
				refundNo: "refund-1",
				status: "processing",
				medicalStatus: "processing",
				wechatStatus: "processing",
				amounts: {
					totalFen: 100,
					cashFen: 40,
					personalAccountFen: 0,
					fundFen: 60,
				},
			};
		},
		async query() {
			return undefined;
		},
	};
	const app = new Elysia()
		.use(requestContextPlugin())
		.use(errorHandlerPlugin())
		.group("/api/v1", (api) =>
			api.use(
				hisMedicalInsuranceRefundModule(service, {
					token,
					hmacSecret,
					security,
					now: () => now,
				}),
			),
		);
	const first = requestFor(
		"POST",
		"/his/medical-insurance-refunds",
		{ orderId: "order-1" },
		"nonce-000000000002",
	);
	const firstResponse = await app.handle(first);
	const secondResponse = await app.handle(
		requestFor(
			"POST",
			"/his/medical-insurance-refunds",
			{ orderId: "order-1" },
			"nonce-000000000002",
		),
	);
	expect(firstResponse.status).toBe(200);
	expect(secondResponse.status).toBe(409);
	expect(calls).toBe(1);
});

test("HIS refund route rejects an unexpected source IP", async () => {
	const security = createSecurityStore();
	const service = {
		async requestFullRefundByOrder() {
			throw new Error("must not call service");
		},
		async query() {
			return undefined;
		},
	};
	const app = new Elysia()
		.use(requestContextPlugin())
		.use(errorHandlerPlugin())
		.group("/api/v1", (api) =>
			api.use(
				hisMedicalInsuranceRefundModule(service, {
					token,
					hmacSecret,
					security,
					now: () => now,
				}),
			),
		);
	const request = requestFor(
		"POST",
		"/his/medical-insurance-refunds",
		{ orderId: "order-1" },
		"nonce-000000000003",
	);
	request.headers.set("x-real-ip", "10.0.0.3");
	const response = await app.handle(request);
	expect(response.status).toBe(403);
});

test("HIS split routes preserve orderId compatibility and accept signed provider identifiers", async () => {
	const security = createSecurityStore();
	const calls: string[] = [];
	const medicalOrderCalls: unknown[] = [];
	const medicalPayOrdIdCalls: unknown[] = [];
	const wechatOrderCalls: Array<{ input: unknown; context: unknown }> = [];
	const wechatOutTradeNoCalls: Array<{ input: unknown; context: unknown }> = [];
	const logs: Array<Record<string, unknown>> = [];
	const logger = {
		info(fields: Record<string, unknown>) {
			logs.push(fields);
		},
		warn(fields: Record<string, unknown>) {
			logs.push(fields);
		},
		error(fields: Record<string, unknown>) {
			logs.push(fields);
		},
	} as unknown as AppLogger;
	const medicalResult: MedicalInsuranceRefundPayload["data"] = {
		orderId: "order-1",
		refundNo: "RFMI-medical-leg",
		status: "succeeded",
		medicalStatus: "success",
		wechatStatus: "not_required",
		amounts: {
			totalFen: 60,
			cashFen: 0,
			personalAccountFen: 0,
			fundFen: 60,
		},
	};
	const wechatResult: WechatRefund = {
		refundRecordId: "refund-1",
		merchantRefundNo: "RFHIS-wechat-leg",
		idempotencyKey: "his-medical-wechat-leg:order-1",
		source: "medical_insurance",
		sourceOrderId: "order-1",
		outTradeNo: "out-trade-1",
		totalFen: 40,
		refundFen: 40,
		reason: null,
		status: "success",
		providerStatus: "SUCCESS",
		providerRefundId: "provider-refund-1",
		providerTransactionId: "provider-transaction-1",
		providerRequestId: "provider-request-1",
		successTime: now.toString(),
		lastErrorCode: null,
		version: 1,
		createdAt: new Date(now).toISOString(),
		updatedAt: new Date(now).toISOString(),
	};
	const service = {
		async requestFullRefundByOrder() {
			throw new Error("not used");
		},
		async query() {
			return undefined;
		},
	};
	const app = new Elysia()
		.use(requestContextPlugin())
		.use(errorHandlerPlugin())
		.group("/api/v1", (api) =>
			api.use(
				hisMedicalInsuranceRefundModule(
					service,
					{
						token,
						hmacSecret,
						security,
						now: () => now,
						logger,
					},
					{
						medicalInsurance: {
							async requestMedicalOnlyByOrder(input: unknown) {
								calls.push("medical-order");
								medicalOrderCalls.push(input);
								return medicalResult;
							},
							async requestMedicalOnlyByPayOrdId(input: unknown) {
								calls.push("medical-pay-ord-id");
								medicalPayOrdIdCalls.push(input);
								return medicalResult;
							},
						},
						wechat: {
							async requestMedicalInsuranceCashByOrder(
								input: unknown,
								context: unknown,
							) {
								calls.push("wechat-order");
								wechatOrderCalls.push({ input, context });
								return wechatResult;
							},
							async requestMedicalInsuranceCashByOutTradeNo(
								input: unknown,
								context: unknown,
							) {
								calls.push("wechat-out-trade-no");
								wechatOutTradeNoCalls.push({ input, context });
								return wechatResult;
							},
							async query() {
								return wechatResult;
							},
						},
					},
				),
			),
		);

	const medicalResponse = await app.handle(
		requestFor(
			"POST",
			"/his/medical-insurance-leg-refunds",
			{ orderId: "order-1", reason: "legacy order id" },
			"nonce-000000000004",
		),
	);
	const wechatResponse = await app.handle(
		requestFor(
			"POST",
			"/his/wechat-leg-refunds",
			{ orderId: "order-1", reason: "legacy order id" },
			"nonce-000000000005",
		),
	);
	const medicalByPayOrdIdResponse = await app.handle(
		requestFor(
			"POST",
			"/his/medical-insurance-leg-refunds/by-pay-ord-id",
			{ payOrdId: "pay-ord-1", reason: "medical provider id" },
			"nonce-000000000006",
		),
	);
	const wechatByOutTradeNoResponse = await app.handle(
		requestFor(
			"POST",
			"/his/wechat-leg-refunds/by-out-trade-no",
			{ outTradeNo: "out-trade-1", reason: "wechat provider id" },
			"nonce-000000000007",
		),
	);

	expect(medicalResponse.status).toBe(200);
	expect(wechatResponse.status).toBe(200);
	expect(medicalByPayOrdIdResponse.status).toBe(200);
	expect(wechatByOutTradeNoResponse.status).toBe(200);
	expect(calls).toEqual([
		"medical-order",
		"wechat-order",
		"medical-pay-ord-id",
		"wechat-out-trade-no",
	]);
	expect(medicalOrderCalls).toEqual([
		expect.objectContaining({
			orderId: "order-1",
			reason: "legacy order id",
			operatorRef: "his-medical-leg",
			context: expect.objectContaining({
				traceId: "his-test-request-001",
				idempotencyKey: "his-test-request-001",
			}),
		}),
	]);
	expect(wechatOrderCalls).toEqual([
		{
			input: { orderId: "order-1", reason: "legacy order id" },
			context: expect.objectContaining({
				traceId: "his-test-request-001",
				idempotencyKey: "his-test-request-001",
			}),
		},
	]);
	expect(medicalPayOrdIdCalls).toEqual([
		expect.objectContaining({
			payOrdId: "pay-ord-1",
			reason: "medical provider id",
			operatorRef: "his-medical-leg",
			context: expect.objectContaining({
				traceId: "his-test-request-001",
				idempotencyKey: "his-test-request-001",
			}),
		}),
	]);
	expect(wechatOutTradeNoCalls).toEqual([
		{
			input: { outTradeNo: "out-trade-1", reason: "wechat provider id" },
			context: expect.objectContaining({
				traceId: "his-test-request-001",
				idempotencyKey: "his-test-request-001",
			}),
		},
	]);
	expect(
		logs.filter((entry) => entry.event === "his.refund.accepted"),
	).toHaveLength(4);
	expect(
		logs.filter((entry) => entry.event === "his.refund.completed"),
	).toHaveLength(4);
	expect(JSON.stringify(logs)).not.toContain(token);
	expect(JSON.stringify(logs)).not.toContain("nonce-000000000004");
});
