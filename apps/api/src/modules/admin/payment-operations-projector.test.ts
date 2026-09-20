import { expect, test } from "bun:test";
import type { MedicalInsuranceOrder, PaymentOrder } from "@hospital/domain";
import { createInMemoryPaymentOperationsRepository } from "@hospital/persistence";
import {
	projectMedicalInsuranceOrder,
	projectPaymentOrder,
} from "./payment-operations-projector";

const timestamps = {
	createdAt: "2026-09-20T00:00:00.000Z",
	updatedAt: "2026-09-20T00:01:00.000Z",
};

function paymentOrder(overrides: Partial<PaymentOrder> = {}): PaymentOrder {
	return {
		orderId: "payment-ops-order-001",
		ownerUserId: "user-001",
		patientId: "patient-001",
		idempotencyKey: "outpatient-self-pay:record-001",
		amounts: { totalFen: 500, insuranceFen: 0, cashFen: 500 },
		state: "cash_paid",
		version: 1,
		...timestamps,
		...overrides,
	};
}

function medicalOrder(
	overrides: Partial<MedicalInsuranceOrder> = {},
): MedicalInsuranceOrder {
	return {
		medicalOrderId: "medical-ops-order-001",
		ownerUserId: "user-001",
		patientId: "patient-001",
		businessType: "outpatient",
		orderType: "DiagPay",
		businessId: "record-001",
		idempotencyKey: "medical:record-001",
		medOrgOrd: "med-org-001",
		chrgBchno: "batch-001",
		payOrdId: "pay-ord-001",
		payTokenHash: null,
		mdtrtId: null,
		acctUsedFlag: null,
		status: "insurance_settled",
		ordStas: "4",
		amounts: {
			totalFen: 17_600,
			cashFen: 11_561,
			personalAccountFen: 0,
			fundFen: 6_039,
		},
		setlType: "ALL",
		revsTokenHash: null,
		revsTokenExpiresAt: null,
		lastError: null,
		medInsFailReason: null,
		wechatMixTradeNo: null,
		wechatOutTradeNo: "wx-out-001",
		wechatPayParams: null,
		wechatPrepayExpiresAt: null,
		wechatPaymentState: "cash_paid",
		version: 1,
		...timestamps,
		...overrides,
	};
}

test("payment order projection keeps a replay-safe aggregate, leg and event", async () => {
	const repository = createInMemoryPaymentOperationsRepository();
	const first = await projectPaymentOrder(repository, paymentOrder());

	expect(first.aggregate.status).toBe("paid");
	expect(first.aggregate.hisSyncStatus).toBe("not_required");
	expect(first.legs).toHaveLength(1);
	expect(first.legs[0]).toMatchObject({
		legType: "wechat_cash",
		amountFen: 500,
		status: "confirmed",
	});
	expect(first.event?.payloadDigest).toMatch(/^[a-f0-9]{64}$/);

	const replay = await projectPaymentOrder(repository, paymentOrder());
	expect(replay.event).toBeUndefined();
	expect(await repository.listEvents(first.aggregate.aggregateId)).toHaveLength(
		1,
	);

	const updated = await projectPaymentOrder(
		repository,
		paymentOrder({
			state: "completed",
			version: 2,
			updatedAt: "2026-09-20T00:02:00.000Z",
		}),
	);
	expect(updated.aggregate.sourceVersion).toBe(2);
	expect(await repository.listEvents(first.aggregate.aggregateId)).toHaveLength(
		2,
	);
});

test("medical projection keeps医保 and微信 as two legs of one aggregate", async () => {
	const repository = createInMemoryPaymentOperationsRepository();
	const projection = await projectMedicalInsuranceOrder(
		repository,
		medicalOrder(),
	);

	expect(projection?.aggregate.totalFen).toBe(17_600);
	expect(projection?.aggregate.insuranceFen).toBe(6_039);
	expect(projection?.aggregate.cashFen).toBe(11_561);
	expect(projection?.aggregate.hisSyncStatus).toBe("pending");
	expect(projection?.legs).toEqual(
		expect.arrayContaining([
			expect.objectContaining({
				legType: "medical_insurance",
				amountFen: 6_039,
				status: "confirmed",
			}),
			expect.objectContaining({
				legType: "wechat_cash",
				amountFen: 11_561,
				status: "confirmed",
			}),
		]),
	);
	const medicalLeg = projection?.legs.find(
		(leg) => leg.legType === "medical_insurance",
	);
	expect(medicalLeg?.providerReferenceDigest).toMatch(/^[a-f0-9]{64}$/);
});
