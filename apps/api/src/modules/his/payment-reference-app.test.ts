import { expect, test } from "bun:test";
import { createHash, createHmac } from "node:crypto";
import type { AdapterCallContext, WechatRefund } from "@hospital/domain";
import { createLogger } from "@hospital/observability";
import { createApp } from "../../app";
import {
	type ApplicationServices,
	createDefaultApplicationServices,
} from "../../application";

const route = "/his/wechat-leg-refunds/by-third-part-pay-record-id";
const token = "his-app-reference-test-token";
const hmacSecret = "his-app-reference-test-secret";
const rootOrderId = "af110eca-55ca-4e12-b074-570a6a215084";

function signedRequest(referenceId: string, suffix: string): Request {
	const timestamp = String(Math.floor(Date.now() / 1000));
	const nonce = `his-app-reference-nonce-${suffix}`;
	const requestId = `his-app-reference-request-${suffix}`;
	// 保留独立原始 19 位整数文本，禁止经过 JS number 或被测签名 helper。
	const rawBody = `{"thirdPartPayRecordId":${referenceId}}`;
	const digest = createHash("sha256").update(rawBody).digest("hex");
	const signature = createHmac("sha256", hmacSecret)
		.update(["POST", route, timestamp, nonce, requestId, digest].join("\n"))
		.digest("hex");
	return new Request(`http://localhost/api/v1${route}`, {
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
		body: rawBody,
	});
}

function fixture(found = true) {
	const resolved: string[] = [];
	const cashCalls: Array<{ input: unknown; context: AdapterCallContext }> = [];
	const forbiddenCalls: string[] = [];
	const lines: string[] = [];
	const logger = createLogger({
		service: "his-reference-app-test",
		environment: "test",
		level: "info",
		destination: { write: (line: string) => void lines.push(line) },
	});
	const rejectOtherRefund = async () => {
		forbiddenCalls.push("non-cash-refund");
		throw new Error(
			"The numeric cash reference must not trigger another refund",
		);
	};
	const result: WechatRefund = {
		refundRecordId: "cash-refund-record-1",
		merchantRefundNo: "RFHIS-app-reference-1",
		idempotencyKey: `his-medical-wechat-leg:${rootOrderId}`,
		source: "medical_insurance",
		sourceOrderId: rootOrderId,
		outTradeNo: "original-wechat-trade-1",
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
		createdAt: new Date().toISOString(),
		updatedAt: new Date().toISOString(),
	};
	const nonces = new Set<string>();
	const app = createApp({
		logger,
		hisRefundToken: token,
		hisRefundHmacSecret: hmacSecret,
		hisRefundSecurity: {
			async reserveNonce(nonce) {
				if (nonces.has(nonce)) return false;
				nonces.add(nonce);
				return true;
			},
			async incrementRateLimit() {
				return 1;
			},
		},
		services: {
			...createDefaultApplicationServices(),
			medicalInsuranceRefund: {
				requestFullRefundByOrder: rejectOtherRefund,
				requestMedicalOnlyByOrder: rejectOtherRefund,
				requestMedicalOnlyByPayOrdId: rejectOtherRefund,
			} as unknown as NonNullable<
				ApplicationServices["medicalInsuranceRefund"]
			>,
			wechatRefund: {
				async requestMedicalInsuranceCashByOrder(
					input: { orderId: string; reason?: string },
					context: AdapterCallContext,
				) {
					cashCalls.push({ input, context });
					return result;
				},
				requestMedicalInsuranceCashByOutTradeNo: rejectOtherRefund,
			} as unknown as NonNullable<ApplicationServices["wechatRefund"]>,
			async hisPaymentReferenceResolver(referenceId) {
				resolved.push(referenceId);
				return found
					? {
							medicalOrderId: rootOrderId,
							paymentScopeId: `${rootOrderId}:wechat_cash`,
							source: "component" as const,
						}
					: undefined;
			},
		},
	});
	return { app, resolved, cashCalls, forbiddenCalls, lines };
}

test("createApp injects the exact 19 digit HIS resolver through global context, logging and JSON parsing", async () => {
	const state = fixture();
	const response = await state.app.handle(
		signedRequest("1952638941030000004", "success"),
	);
	const body = await response.json();
	await Bun.sleep(0);
	expect(response.status).toBe(200);
	expect(response.headers.get("x-request-id")).toBe(
		"his-app-reference-request-success",
	);
	expect(state.resolved).toEqual(["1952638941030000004"]);
	expect(state.cashCalls).toEqual([
		{
			input: { orderId: rootOrderId },
			context: expect.objectContaining({
				traceId: "his-app-reference-request-success",
				idempotencyKey: "his-app-reference-request-success",
			}),
		},
	]);
	expect(state.forbiddenCalls).toEqual([]);
	expect(body).toMatchObject({
		success: true,
		data: {
			orderId: rootOrderId,
			refundNo: "RFHIS-app-reference-1",
			status: "processing",
			amounts: { cashFen: 40, fundFen: 0, personalAccountFen: 0 },
		},
	});
	const logs = state.lines.map(
		(line) => JSON.parse(line) as Record<string, unknown>,
	);
	expect(logs).toContainEqual(
		expect.objectContaining({
			event: "http.request.completed",
			requestId: "his-app-reference-request-success",
			statusCode: 200,
		}),
	);
	expect(state.lines.join("")).not.toContain("1952638941030000004");
});

test("createApp unknown HIS cash reference returns 404 without invoking a refund", async () => {
	const state = fixture(false);
	const response = await state.app.handle(
		signedRequest("9223372036854775807", "unknown"),
	);
	expect(response.status).toBe(404);
	expect(await response.json()).toMatchObject({
		success: false,
		error: { code: "not_found" },
	});
	expect(state.resolved).toEqual(["9223372036854775807"]);
	expect(state.cashCalls).toEqual([]);
	expect(state.forbiddenCalls).toEqual([]);
});
