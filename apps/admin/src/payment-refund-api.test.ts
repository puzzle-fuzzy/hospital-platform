import { afterEach, expect, test } from "bun:test";
import { queryPaymentRefund, requestPaymentRefund } from "./api";
import type {
	AdminPaymentRefundResult,
	AdminPaymentRefundType,
	Session,
} from "./types";

const originalFetch = globalThis.fetch;
afterEach(() => {
	globalThis.fetch = originalFetch;
});
const session: Session = {
	accessToken: "local-test-token",
	refreshToken: "local-test-refresh",
	tokenType: "Bearer",
	expiresIn: 3600,
	username: "local-test-operator",
};

test.each(["ALL", "HI", "CASH"] as const)(
	"refund API sends selected %s scope with existing session and no browser amount",
	async (refundType: AdminPaymentRefundType) => {
		let captured:
			| { path: unknown; options: RequestInit | undefined }
			| undefined;
		const result: AdminPaymentRefundResult = {
			source: "medical_insurance",
			orderId: "test-order",
			refundType,
			status: "processing",
			amounts: {
				totalFen: 8000,
				cashFen: 6680,
				personalAccountFen: 0,
				fundFen: 1320,
			},
		};
		globalThis.fetch = (async (path, options) => {
			captured = { path, options };
			return Response.json({ code: 0, data: result });
		}) as typeof fetch;
		await expect(
			requestPaymentRefund(
				{
					source: "medical_insurance",
					orderId: "test-order",
					refundType,
					reason: "测试退款原因",
				},
				session,
			),
		).resolves.toEqual(result);
		expect(captured?.path).toBe("/api/refunds/payment");
		expect(captured?.options?.method).toBe("POST");
		expect(captured?.options?.credentials).toBe("same-origin");
		expect(captured?.options?.cache).toBe("no-store");
		expect(new Headers(captured?.options?.headers).get("Authorization")).toBe(
			"Bearer local-test-token",
		);
		expect(JSON.parse(String(captured?.options?.body))).toEqual({
			source: "medical_insurance",
			orderId: "test-order",
			refundType,
			reason: "测试退款原因",
		});
	},
);

test("order-level refund query encodes the order and retains session", async () => {
	let captured: { path: unknown; options: RequestInit | undefined } | undefined;
	globalThis.fetch = (async (path, options) => {
		captured = { path, options };
		return Response.json({ code: 0, data: { status: "succeeded" } });
	}) as typeof fetch;
	await queryPaymentRefund("payment_order", "test/order?scope=1", session);
	expect(captured?.path).toBe(
		"/api/refunds/payment/payment_order/test%2Forder%3Fscope%3D1?refundType=ALL",
	);
	expect(new Headers(captured?.options?.headers).get("Authorization")).toBe(
		"Bearer local-test-token",
	);
	expect(captured?.options?.body).toBeUndefined();
});

test.each(["ALL", "HI", "CASH"] as const)(
	"order-level query retains selected %s scope",
	async (refundType: AdminPaymentRefundType) => {
		let requestedPath: unknown;
		globalThis.fetch = (async (path) => {
			requestedPath = path;
			return Response.json({ code: 0, data: { status: "succeeded" } });
		}) as typeof fetch;
		await queryPaymentRefund(
			"medical_insurance",
			"test-order",
			session,
			refundType,
		);
		expect(requestedPath).toBe(
			`/api/refunds/payment/medical_insurance/test-order?refundType=${refundType}`,
		);
	},
);
