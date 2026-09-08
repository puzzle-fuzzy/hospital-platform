import { expect, test } from "bun:test";
import type {
	MedicalInsuranceOrder,
	MedicalInsuranceWechatPaymentGateway,
} from "@hospital/domain";
import { createLogger, type AppLogger } from "@hospital/observability";
import { createInMemoryMedicalInsuranceOrderRepository } from "@hospital/persistence";
import { MedicalInsuranceWechatPaymentService } from "./wechat-payment-service";

const now = "2026-09-08T08:00:00.000Z";

function order(
	overrides: Partial<MedicalInsuranceOrder> = {},
): MedicalInsuranceOrder {
	return {
		medicalOrderId: "wechat-query-001",
		ownerUserId: "user-wechat-query-001",
		patientId: "patient-wechat-query-001",
		businessType: "registration",
		orderType: "RegPay",
		businessId: "appointment-wechat-query-001",
		appointmentId: "appointment-wechat-query-001",
		idempotencyKey: "wechat-query-idempotency-001",
		medOrgOrd: "med-org-wechat-query-001",
		chrgBchno: "batch-wechat-query-001",
		payOrdId: "pay-ord-wechat-query-001",
		payTokenHash: null,
		mdtrtId: null,
		acctUsedFlag: null,
		status: "cash_pending",
		ordStas: "2",
		amounts: {
			totalFen: 1000,
			cashFen: 200,
			personalAccountFen: 300,
			fundFen: 500,
		},
		setlType: "ALL",
		revsTokenHash: null,
		revsTokenExpiresAt: null,
		lastError: null,
		wechatMixTradeNo: "mix-query-001",
		wechatOutTradeNo: "out-query-001",
		wechatPaymentState: "prepay_ready",
		wechatPayParams: null,
		version: 1,
		createdAt: now,
		updatedAt: now,
		...overrides,
	};
}

function makeService(
	orders: ReturnType<typeof createInMemoryMedicalInsuranceOrderRepository>,
	queryResult: Awaited<
		ReturnType<MedicalInsuranceWechatPaymentGateway["queryMixedOrder"]>
	>,
	logger?: AppLogger,
) {
	const wechatPayment = {
		queryMixedOrder: async () => queryResult,
	} as unknown as MedicalInsuranceWechatPaymentGateway;
	return new MedicalInsuranceWechatPaymentService({
		orders,
		authorizations: {} as never,
		identityUsers: {} as never,
		wechatPayment,
		confirmCashPayment: async () => {
			throw new Error("should not complete a failed query");
		},
		...(logger ? { logger } : {}),
	});
}

test("医保查单失败原因会持久化并透传给支付小程序", async () => {
	const orders = createInMemoryMedicalInsuranceOrderRepository();
	await orders.insert(order());
	const lines: string[] = [];
	const service = makeService(
		orders,
		{
			cashState: "paid",
			insuranceState: "failed",
			medInsPayStatus: "MED_INS_PAY_FAIL",
			medInsFailReason: "医保局具体失败原因",
			cashFen: 200,
			totalFen: 1000,
			providerStatus: "MIX_PAY_FAIL/SELF_PAY_SUCCESS/MED_INS_PAY_FAIL",
			trace: {
				provider: "wechat-pay",
				operation: "medical-mix-query",
				requestId: "wechat-query-provider-001",
			},
		},
		createLogger({
			service: "medical-insurance-test",
			environment: "test",
			level: "info",
			destination: { write: (chunk) => lines.push(chunk) },
		}),
	);

	const result = await service.query({
		ownerUserId: "user-wechat-query-001",
		orderId: "wechat-query-001",
		context: {
			traceId: "wechat-query-trace-001",
			idempotencyKey: "wechat-query-request-001",
		},
	});

	expect(result).toMatchObject({
		paymentState: "failed",
		medInsFailReason: "医保局具体失败原因",
	});
	expect(await orders.findByMedicalOrderId("wechat-query-001")).toMatchObject({
		medInsFailReason: "医保局具体失败原因",
	});
	const queriedLog = lines
		.map((line) => JSON.parse(line) as Record<string, unknown>)
		.find((line) => line.event === "medical-insurance.wechat-mix.queried");
	expect(queriedLog).toMatchObject({
		medInsPayStatus: "MED_INS_PAY_FAIL",
		medInsFailReason: "医保局具体失败原因",
	});
});

test("自费失败不会产生医保失败原因字段", async () => {
	const orders = createInMemoryMedicalInsuranceOrderRepository();
	await orders.insert(order({ medInsFailReason: "旧医保失败原因" }));
	const service = makeService(orders, {
		cashState: "failed",
		insuranceState: "paid",
		medInsPayStatus: "MED_INS_PAY_SUCCESS",
		cashFen: 200,
		totalFen: 1000,
		providerStatus: "MIX_PAY_FAIL/SELF_PAY_FAIL/MED_INS_PAY_SUCCESS",
		trace: {
			provider: "wechat-pay",
			operation: "medical-mix-query",
			requestId: "wechat-query-provider-002",
		},
	});

	const result = await service.query({
		ownerUserId: "user-wechat-query-001",
		orderId: "wechat-query-001",
		context: {
			traceId: "wechat-query-trace-002",
			idempotencyKey: "wechat-query-request-002",
		},
	});

	expect(result).not.toHaveProperty("medInsFailReason");
	expect(await orders.findByMedicalOrderId("wechat-query-001")).toMatchObject({
		medInsFailReason: null,
	});
});
