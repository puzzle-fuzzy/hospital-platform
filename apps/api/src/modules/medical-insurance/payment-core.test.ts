import { expect, test } from "bun:test";
import type { MedicalInsuranceOrder } from "@hospital/domain";
import { createInMemoryMedicalInsuranceOrderRepository } from "@hospital/persistence";
import { MedicalInsurancePaymentCore } from "./payment-core";

const context = {
	traceId: "trace-medical-payment-core-001",
	idempotencyKey: "idem-medical-payment-core-001",
};

test("6301查单不丢失6202已经确认的扩展金额", async () => {
	const orders = createInMemoryMedicalInsuranceOrderRepository();
	const original: MedicalInsuranceOrder = {
		medicalOrderId: "medical-order-query-001",
		ownerUserId: "owner-query-001",
		patientId: "patient-query-001",
		businessType: "registration",
		orderType: "RegPay",
		businessId: "appointment-query-001",
		appointmentId: "appointment-query-001",
		idempotencyKey: "medical-idem-query-001",
		medOrgOrd: "medical-org-query-001",
		chrgBchno: "batch-query-001",
		payOrdId: "pay-order-query-001",
		payTokenHash: null,
		status: "awaiting_confirmation",
		ordStas: "1",
		amounts: {
			totalFen: 100,
			cashFen: 0,
			personalAccountFen: 20,
			fundFen: 70,
			otherPaymentFen: 10,
			hospitalPartFen: 10,
			personalAccountMutualAidFen: 5,
			personalAccountSelfFen: 15,
			depositFen: 1,
			deliveryFeeFen: 2,
		},
		setlType: "ALL",
		revsTokenHash: null,
		revsTokenExpiresAt: null,
		lastError: null,
		version: 1,
		createdAt: "2026-09-10T00:00:00.000Z",
		updatedAt: "2026-09-10T00:00:00.000Z",
	};
	await orders.insert(original);
	const core = new MedicalInsurancePaymentCore({
		orders,
		medicalInsurance: {
			query: async () => ({
				state: "cash_pending",
				amounts: { totalFen: 100, insuranceFen: 100, cashFen: 0 },
				trace: {
					provider: "legacy-fsi",
					operation: "medical-settlement-query",
					requestId: "provider-query-001",
				},
				source: "6301",
				providerStatus: "3",
				finality: "settlement_candidate",
				authoritative: true,
			}),
		} as never,
	});

	await core.query({
		ownerUserId: original.ownerUserId,
		orderId: original.medicalOrderId,
		context,
	});

	const updated = await orders.findByMedicalOrderId(original.medicalOrderId);
	expect(updated?.amounts).toEqual(original.amounts);
});

test("已完成门诊订单查单直接返回已落库金额，不依赖医保上游", async () => {
	const orders = createInMemoryMedicalInsuranceOrderRepository();
	const original: MedicalInsuranceOrder = {
		medicalOrderId: "medical-order-outpatient-settled-001",
		ownerUserId: "owner-outpatient-settled-001",
		patientId: "patient-outpatient-settled-001",
		businessType: "outpatient",
		orderType: "DiagPay",
		businessId: "outpatient-record-settled-001",
		idempotencyKey: "medical-idem-outpatient-settled-001",
		medOrgOrd: "medical-org-outpatient-settled-001",
		chrgBchno: "batch-outpatient-settled-001",
		payOrdId: "pay-order-outpatient-settled-001",
		payTokenHash: "pay-token-hash-outpatient-settled-001",
		status: "insurance_settled",
		ordStas: "6",
		amounts: {
			totalFen: 10000,
			cashFen: 3000,
			personalAccountFen: 2000,
			fundFen: 5000,
			otherPaymentFen: 0,
			hospitalPartFen: 0,
			personalAccountMutualAidFen: 0,
			personalAccountSelfFen: 2000,
			depositFen: 0,
			deliveryFeeFen: 0,
		},
		setlType: "CASH",
		revsTokenHash: null,
		revsTokenExpiresAt: null,
		lastError: null,
		version: 3,
		createdAt: "2026-09-18T00:00:00.000Z",
		updatedAt: "2026-09-18T00:01:00.000Z",
	};
	await orders.insert(original);
	let upstreamCalls = 0;
	const core = new MedicalInsurancePaymentCore({
		orders,
		medicalInsurance: {
			query: async () => {
				upstreamCalls += 1;
				throw new Error("医保上游暂时不可用");
			},
		} as never,
	});

	await expect(
		core.query({
			ownerUserId: original.ownerUserId,
			orderId: original.medicalOrderId,
			context,
		}),
	).resolves.toEqual({
		orderId: original.medicalOrderId,
		status: "insurance_settled",
		amounts: { totalFen: 10000, insuranceFen: 7000, cashFen: 3000 },
	});
	expect(upstreamCalls).toBe(0);
});

test("2.6.65.1已创建但6201未完成时重授权会取消上游结算", async () => {
	const orders = createInMemoryMedicalInsuranceOrderRepository();
	const original: MedicalInsuranceOrder = {
		medicalOrderId: "medical-order-pre-6201-001",
		ownerUserId: "owner-pre-6201-001",
		patientId: "patient-pre-6201-001",
		businessType: "registration",
		orderType: "RegPay",
		businessId: "appointment-pre-6201-001",
		appointmentId: "appointment-pre-6201-001",
		idempotencyKey: "medical-idem-pre-6201-001",
		medOrgOrd: "medical-org-pre-6201-001",
		chrgBchno: "batch-pre-6201-001",
		payOrdId: null,
		payTokenHash: null,
		status: "created",
		ordStas: null,
		amounts: null,
		setlType: null,
		revsTokenHash: null,
		revsTokenExpiresAt: null,
		lastError: null,
		version: 1,
		createdAt: "2026-09-10T00:00:00.000Z",
		updatedAt: "2026-09-10T00:00:00.000Z",
	};
	await orders.insert(original);
	await orders.saveSettlementContext(
		original.ownerUserId,
		original.medicalOrderId,
		{
			businessId: "settlement-pre-6201-001",
			businessCode: "trade-code-pre-6201-001",
			hospitalId: "10389",
			patientId: "provider-patient-pre-6201-001",
			networkRegister: {},
			outNetworkSettleMain: {},
			nationalUpDetailList: [],
			upDetailList: [],
			tradeOrderIds: ["trade-order-pre-6201-001"],
			insuredAreaCode: "140581",
			feeUploadStage: "pre_6201",
			settlementAmountFen: 100,
		},
	);
	const cancellations: Array<{
		ownerUserId: string;
		orderId: string;
		reason: string;
	}> = [];
	const core = new MedicalInsurancePaymentCore({
		orders,
		medicalInsurance: {
			cancel: async (input: {
				ownerUserId: string;
				orderId: string;
				reason: string;
			}) => {
				cancellations.push(input);
				return {
					state: "cancelled" as const,
					paymentState: "not_created" as const,
					settlementState: "cancelled" as const,
					providerStatus: "settlement_cancelled",
					trace: {
						provider: "medical-insurance" as const,
						operation: "medical-insurance.cancellation",
						requestId: "cancel-pre-6201-001",
					},
				};
			},
		} as never,
	});

	await expect(
		core.cancel({
			ownerUserId: original.ownerUserId,
			orderId: original.medicalOrderId,
			reason: "reauthorization",
			context,
		}),
	).resolves.toMatchObject({
		status: "cancelled",
		settlementState: "cancelled",
	});
	expect(cancellations).toEqual([
		{
			ownerUserId: original.ownerUserId,
			orderId: original.medicalOrderId,
			reason: "reauthorization",
		},
	]);
	await expect(
		orders.findByMedicalOrderId(original.medicalOrderId),
	).resolves.toMatchObject({ status: "cancelled", ordStas: null });
});
