import { expect, test } from "bun:test";
import type { MedicalInsuranceOrder } from "@hospital/domain";
import { createInMemoryMedicalInsuranceOrderRepository } from "@hospital/persistence";
import {
	parseMedicalInsuranceContextRepairArgs,
	parseMedicalInsuranceContextRepairInput,
	repairMedicalInsuranceSettlementContext,
} from "./medical-insurance-context-repair";

function order(status: MedicalInsuranceOrder["status"] = "fee_uploaded") {
	return {
		medicalOrderId: "medical-repair-001",
		ownerUserId: "user-repair-001",
		patientId: "patient-repair-001",
		appointmentId: "appointment-repair-001",
		authorizationId: "authorization-repair-001",
		feeUploadId: "fee-repair-001",
		idempotencyKey: "idempotency-repair-001",
		medOrgOrd: "medical-repair-001",
		chrgBchno: "charge-repair-001",
		payOrdId: "pay-repair-001",
		payTokenHash: "a".repeat(64),
		mdtrtId: "mdtrt-repair-001",
		acctUsedFlag: "1",
		status,
		ordStas: null,
		amounts: null,
		setlType: null,
		revsTokenHash: null,
		revsTokenExpiresAt: null,
		lastError: null,
		version: 1,
		createdAt: "2026-09-06T00:00:00.000Z",
		updatedAt: "2026-09-06T00:00:00.000Z",
	} satisfies MedicalInsuranceOrder;
}

const repairInput = {
	businessId: "provider-business-001",
	businessCode: "provider-business-code-001",
	hospitalId: "provider-hospital-001",
	patientId: "provider-patient-001",
	tradeOrderIds: ["provider-trade-order-001"],
	payingId: "260650000000001",
	tradingId: "260650000000002",
	evidenceSource: "provider-log" as const,
};

test("关单上下文修复命令要求平台订单号和人工确认", () => {
	expect(
		parseMedicalInsuranceContextRepairArgs([
			"--order-id",
			"medical-repair-001",
			"--confirm",
		]),
	).toEqual({ orderId: "medical-repair-001", confirmed: true });
	expect(() =>
		parseMedicalInsuranceContextRepairArgs([
			"--order-id",
			"medical-repair-001",
		]),
	).toThrow("confirmation-required");
});

test("关单上下文修复输入只接受完整且不重复的 Provider 标识", () => {
	expect(parseMedicalInsuranceContextRepairInput(repairInput)).toEqual(
		repairInput,
	);
	expect(() =>
		parseMedicalInsuranceContextRepairInput({
			...repairInput,
			tradeOrderIds: ["provider-trade-order-001", "provider-trade-order-001"],
		}),
	).toThrow("duplicate-trade-order-id");
	expect(() =>
		parseMedicalInsuranceContextRepairInput({
			...repairInput,
			payingId: "provider-paying-001",
		}),
	).toThrow("invalid-paying-id");
});

test("关单上下文修复只补空上下文，不覆盖已有上下文", async () => {
	const orders = createInMemoryMedicalInsuranceOrderRepository();
	await orders.insert(order());
	await expect(
		repairMedicalInsuranceSettlementContext({
			orderId: "medical-repair-001",
			context: repairInput,
			orders,
		}),
	).resolves.toMatchObject({
		orderId: "medical-repair-001",
		contextSaved: true,
		tradeOrderCount: 1,
	});
	expect(
		await orders.getSettlementContext("user-repair-001", "medical-repair-001"),
	).toMatchObject({
		businessId: "provider-business-001",
		payingId: "260650000000001",
		tradingId: "260650000000002",
	});
	await expect(
		repairMedicalInsuranceSettlementContext({
			orderId: "medical-repair-001",
			context: repairInput,
			orders,
		}),
	).rejects.toThrow("settlement-context-already-exists");
});

test("关单上下文修复拒绝已完成或已取消订单", async () => {
	for (const status of ["cancelled", "insurance_settled"] as const) {
		const orders = createInMemoryMedicalInsuranceOrderRepository();
		await orders.insert(order(status));
		await expect(
			repairMedicalInsuranceSettlementContext({
				orderId: "medical-repair-001",
				context: repairInput,
				orders,
			}),
		).rejects.toThrow("medical-order-terminal");
	}
});
