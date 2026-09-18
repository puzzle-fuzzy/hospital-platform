import { expect, test } from "bun:test";
import { ProviderRequestError } from "@hospital/adapters";
import type {
	MedicalInsuranceOrder,
	PaymentOrder,
	WechatRefund,
	WechatRefundProviderResult,
} from "@hospital/domain";
import {
	createInMemoryMedicalInsuranceOrderRepository,
	createInMemoryPaymentOrderRepository,
	createInMemoryWechatRefundRepository,
} from "@hospital/persistence";
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

function paidMedicalOrder(): MedicalInsuranceOrder {
	return {
		medicalOrderId: "medical-order-refund-history-001",
		ownerUserId: "fixture-user-001",
		patientId: "fixture-patient-001",
		businessType: "outpatient",
		orderType: "DiagPay",
		businessId: "outpatient-record-history-001",
		idempotencyKey: "medical-refund-history-001",
		medOrgOrd: "med-org-history-001",
		chrgBchno: "charge-history-001",
		payOrdId: null,
		payTokenHash: null,
		status: "cash_pending",
		ordStas: "1",
		amounts: {
			totalFen: 500,
			cashFen: 500,
			personalAccountFen: 0,
			fundFen: 0,
		},
		setlType: "CASH",
		revsTokenHash: null,
		revsTokenExpiresAt: null,
		lastError: null,
		wechatOutTradeNo: "medical-wechat-out-history-001",
		wechatPaymentState: "cash_paid",
		version: 1,
		createdAt: "2026-09-18T01:00:00.000Z",
		updatedAt: "2026-09-18T01:05:00.000Z",
	};
}

function ledgerRefund(input: {
	refundRecordId: string;
	merchantRefundNo: string;
	source: WechatRefund["source"];
	sourceOrderId: string;
	refundFen: number;
	status: WechatRefund["status"];
	updatedAt: string;
}): WechatRefund {
	return {
		refundRecordId: input.refundRecordId,
		merchantRefundNo: input.merchantRefundNo,
		idempotencyKey: `history-refund:${input.refundRecordId}`,
		source: input.source,
		sourceOrderId: input.sourceOrderId,
		outTradeNo: `out-trade-${input.refundRecordId}`,
		totalFen: input.source === "medical_insurance" ? 500 : 300,
		refundFen: input.refundFen,
		reason: null,
		status: input.status,
		providerStatus: input.status === "success" ? "SUCCESS" : "PROCESSING",
		providerRefundId: null,
		providerTransactionId: null,
		providerRequestId: null,
		successTime: input.status === "success" ? input.updatedAt : null,
		lastErrorCode: null,
		version: 1,
		createdAt: input.updatedAt,
		updatedAt: input.updatedAt,
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

test("trusted registration refund uses the Provider-saved out_trade_no", async () => {
	const refunds = createInMemoryWechatRefundRepository();
	const registrationOrder: PaymentOrder = {
		...paidOrder(),
		idempotencyKey: "registration-self-pay:appointment-trusted-001",
	};
	const orders = createInMemoryPaymentOrderRepository([registrationOrder]);
	let requestedOutTradeNo = "";
	const service = new AdminWechatRefundService({
		refunds,
		paymentOrders: orders,
		medicalInsuranceOrders: {} as never,
		gateway: {
			async requestRefund(input) {
				requestedOutTradeNo = input.outTradeNo;
				return {
					status: "SUCCESS",
					merchantRefundNo: input.merchantRefundNo,
					providerRefundId: "wechat-refund-trusted-001",
					providerTransactionId: "wechat-transaction-trusted-001",
					outTradeNo: input.outTradeNo,
					totalFen: input.totalFen,
					refundFen: input.refundFen,
					trace: {
						provider: "wechat-pay",
						operation: "refund-request",
						requestId: "wechat-request-trusted-001",
					},
				};
			},
			async queryRefund() {
				throw new Error("confirmed refund must not be queried");
			},
		},
		createId: () => "refundtrusted001",
		now: () => new Date("2026-09-18T01:02:00.000Z"),
	});

	const refund = await service.requestTrustedPaymentOrder(
		{
			orderId: registrationOrder.orderId,
			outTradeNo: "YUNHEALTH-WX-OUT-001",
			refundFen: 300,
			idempotencyKey: "registration-self-pay-refund:appointment-001",
		},
		context,
	);

	expect(requestedOutTradeNo).toBe("YUNHEALTH-WX-OUT-001");
	expect(refund).toMatchObject({
		source: "payment_order",
		sourceOrderId: registrationOrder.orderId,
		outTradeNo: "YUNHEALTH-WX-OUT-001",
		status: "success",
	});
});

test("admin refund history shows prior payments and only enables the safe refund route", async () => {
	const registrationOrder: PaymentOrder = {
		...paidOrder(),
		orderId: "registration-payment-history-001",
		idempotencyKey: "registration-self-pay:appointment-history-001",
		state: "completed",
		amounts: { totalFen: 200, insuranceFen: 0, cashFen: 200 },
		updatedAt: "2026-09-18T01:04:00.000Z",
	};
	const unconfirmedOrder: PaymentOrder = {
		...paidOrder(),
		orderId: "payment-history-unconfirmed-001",
		idempotencyKey: "outpatient-self-pay:record-unconfirmed-001",
		state: "cash_pending",
		updatedAt: "2026-09-18T01:03:00.000Z",
	};
	const paymentOrders = createInMemoryPaymentOrderRepository([
		paidOrder(),
		registrationOrder,
		unconfirmedOrder,
	]);
	const medicalInsuranceOrders =
		createInMemoryMedicalInsuranceOrderRepository();
	await medicalInsuranceOrders.insert(paidMedicalOrder());
	const refunds = createInMemoryWechatRefundRepository([
		ledgerRefund({
			refundRecordId: "refund-history-normal-001",
			merchantRefundNo: "RF-PO-history-normal-001",
			source: "payment_order",
			sourceOrderId: paidOrder().orderId,
			refundFen: 100,
			status: "success",
			updatedAt: "2026-09-18T01:02:00.000Z",
		}),
		ledgerRefund({
			refundRecordId: "refund-history-medical-001",
			merchantRefundNo: "RF-MI-history-medical-001",
			source: "medical_insurance",
			sourceOrderId: paidMedicalOrder().medicalOrderId,
			refundFen: 80,
			status: "processing",
			updatedAt: "2026-09-18T01:06:00.000Z",
		}),
	]);
	const service = new AdminWechatRefundService({
		refunds,
		paymentOrders,
		medicalInsuranceOrders,
		gateway: {
			async requestRefund() {
				throw new Error("history query must not request a refund");
			},
			async queryRefund() {
				throw new Error("history query must not call Wechat");
			},
		},
	});

	const history = await service.listPaymentHistory({ limit: 10 });
	const normal = history.find(
		(record) => record.orderId === paidOrder().orderId,
	);
	const registration = history.find(
		(record) => record.orderId === registrationOrder.orderId,
	);
	const medical = history.find(
		(record) => record.orderId === paidMedicalOrder().medicalOrderId,
	);
	const unconfirmed = history.find(
		(record) => record.orderId === unconfirmedOrder.orderId,
	);

	expect(normal).toMatchObject({
		source: "payment_order",
		business: "other",
		cashPaymentConfirmed: true,
		cashFen: 300,
		refundReservedFen: 100,
		refundableFen: 200,
		refundRoute: "admin",
		latestRefund: {
			merchantRefundNo: "RF-PO-history-normal-001",
			status: "success",
		},
	});
	expect(normal).not.toHaveProperty("ownerUserId");
	expect(normal).not.toHaveProperty("outTradeNo");
	expect(registration).toMatchObject({
		business: "registration",
		refundRoute: "appointment_cancel",
	});
	expect(medical).toMatchObject({
		source: "medical_insurance",
		business: "outpatient",
		cashPaymentConfirmed: true,
		refundReservedFen: 80,
		refundableFen: 420,
		refundRoute: "admin",
	});
	expect(unconfirmed).toMatchObject({
		cashPaymentConfirmed: false,
		refundableFen: 0,
		refundRoute: "unavailable",
	});

	await expect(
		service.request(
			{
				source: "payment_order",
				orderId: registrationOrder.orderId,
				refundFen: 100,
				idempotencyKey: "admin-registration-refund-blocked-001",
			},
			context,
		),
	).rejects.toThrow("挂号自费退款必须从预约取消流程发起");
});
