import { expect, test } from "bun:test";
import { ProviderRequestError } from "@hospital/adapters";
import {
	createInMemoryPaymentOrderRepository,
	createInMemoryWechatRefundRepository,
} from "@hospital/persistence";
import type {
	PaymentOrder,
	WechatRefundProviderResult,
} from "@hospital/domain";
import { AdminWechatRefundService } from "./wechat-refund-service";

const context = {
	traceId: "admin-refund-test-trace-001",
	idempotencyKey: "admin-refund-test-context-001",
};

function paidOrder(): PaymentOrder {
	return {
		orderId: "payment-order-refund-001",
		ownerUserId: "fixture-user-001",
		patientId: "fixture-patient-001",
		idempotencyKey: "payment-order-idempotency-001",
		amounts: { totalFen: 300, insuranceFen: 0, cashFen: 300 },
		state: "cash_paid",
		version: 1,
		createdAt: "2026-09-18T01:00:00.000Z",
		updatedAt: "2026-09-18T01:01:00.000Z",
	};
}

function result(
	status: WechatRefundProviderResult["status"],
): WechatRefundProviderResult {
	return {
		status,
		merchantRefundNo: "RF-PO-refund001",
		providerRefundId: "wechat-refund-001",
		providerTransactionId: "wechat-transaction-001",
		outTradeNo: "payment-order-refund-001",
		totalFen: 300,
		refundFen: 100,
		trace: {
			provider: "wechat-pay",
			operation: "refund-request",
			requestId: "wechat-request-001",
		},
	};
}

test("admin refund reserves a partial refund and preserves idempotency", async () => {
	const refunds = createInMemoryWechatRefundRepository();
	const orders = createInMemoryPaymentOrderRepository([paidOrder()]);
	let requestCount = 0;
	const service = new AdminWechatRefundService({
		refunds,
		paymentOrders: orders,
		medicalInsuranceOrders: {} as never,
		gateway: {
			async requestRefund(input) {
				requestCount += 1;
				expect(input.outTradeNo).toBe("payment-order-refund-001");
				return result("PROCESSING");
			},
			async queryRefund() {
				return result("SUCCESS");
			},
		},
		createId: () => "refund001",
		now: () => new Date("2026-09-18T01:02:00.000Z"),
	});

	const first = await service.request(
		{
			source: "payment_order",
			orderId: paidOrder().orderId,
			refundFen: 100,
			idempotencyKey: "admin-refund-idempotency-001",
		},
		context,
	);
	expect(first.status).toBe("processing");
	expect(requestCount).toBe(1);

	const replay = await service.request(
		{
			source: "payment_order",
			orderId: paidOrder().orderId,
			refundFen: 100,
			idempotencyKey: "admin-refund-idempotency-001",
		},
		context,
	);
	expect(replay.merchantRefundNo).toBe(first.merchantRefundNo);
	expect(requestCount).toBe(1);

	const queried = await service.query(first.merchantRefundNo, context);
	expect(queried.status).toBe("success");
});

test("admin refund does not send a second refund when the first request is unknown", async () => {
	const refunds = createInMemoryWechatRefundRepository();
	const orders = createInMemoryPaymentOrderRepository([paidOrder()]);
	let requestCount = 0;
	const service = new AdminWechatRefundService({
		refunds,
		paymentOrders: orders,
		medicalInsuranceOrders: {} as never,
		gateway: {
			async requestRefund() {
				requestCount += 1;
				throw new ProviderRequestError({
					provider: "wechat-pay",
					operation: "refund-request",
					message: "timeout",
					retryable: true,
					failureStage: "transport",
					requestOutcome: "unknown",
				});
			},
			async queryRefund() {
				return result("PROCESSING");
			},
		},
		createId: () => "refund001",
	});

	const first = await service.request(
		{
			source: "payment_order",
			orderId: paidOrder().orderId,
			refundFen: 100,
			idempotencyKey: "admin-refund-idempotency-002",
		},
		context,
	);
	expect(first.status).toBe("unknown");
	expect(requestCount).toBe(1);

	const recovered = await service.request(
		{
			source: "payment_order",
			orderId: paidOrder().orderId,
			refundFen: 100,
			idempotencyKey: "admin-refund-idempotency-002",
		},
		context,
	);
	expect(recovered.status).toBe("processing");
	expect(requestCount).toBe(1);
});
