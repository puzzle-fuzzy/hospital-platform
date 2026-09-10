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
