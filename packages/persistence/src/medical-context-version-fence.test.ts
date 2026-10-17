import { expect, test } from "bun:test";
import type {
	MedicalInsuranceOrder,
	MedicalInsuranceSettlementContext,
} from "@hospital/domain";
import type { Pool } from "mysql2/promise";
import { createMySqlRepositories } from "./mysql-repositories";
import { createInMemoryMedicalInsuranceOrderRepository } from "./repositories";

const context: MedicalInsuranceSettlementContext = {
	businessId: "fixture-business",
	hospitalId: "fixture-hospital",
	patientId: "fixture-patient",
	networkRegister: {},
	outNetworkSettleMain: {},
	nationalUpDetailList: [],
	upDetailList: [],
	tradeOrderIds: [],
	feeUploadStage: "submitting_6201",
	feeUploadSubmittedAt: "2026-10-17T02:00:00.000Z",
};

test("MySQL context version fence binds source version and fails closed on a lost CAS", async () => {
	const statements: { sql: string; values: readonly unknown[] }[] = [];
	const pool = {
		execute: async (sql: string, values: readonly unknown[]) => {
			statements.push({ sql, values });
			return [{ affectedRows: statements.length === 1 ? 1 : 0 }, []];
		},
	} as unknown as Pool;
	const repository = createMySqlRepositories(pool, {
		medicalInsuranceCredentialEncryptionKey: Buffer.alloc(32, 29).toString(
			"base64",
		),
	}).medicalInsuranceOrders;
	await expect(
		repository.saveSettlementContext(
			"fixture-owner",
			"fixture-order",
			context,
			7,
		),
	).resolves.toBeUndefined();
	expect(statements[0]?.sql).toContain("AND version = ?");
	expect(statements[0]?.sql).not.toContain("version = version + 1");
	expect(statements[0]?.values.slice(1)).toEqual([
		"fixture-order",
		"fixture-owner",
		7,
	]);
	expect(statements[0]?.values[0]).not.toContain("submitting_6201");
	await expect(
		repository.saveSettlementContext(
			"fixture-owner",
			"fixture-order",
			context,
			6,
		),
	).rejects.toThrow("context order is unavailable");
	expect(statements).toHaveLength(2);
});

test("memory context version fence retains recovery context when an older worker writes", async () => {
	const repository = createInMemoryMedicalInsuranceOrderRepository();
	const order: MedicalInsuranceOrder = {
		medicalOrderId: "fixture-order",
		ownerUserId: "fixture-owner",
		patientId: "fixture-patient",
		idempotencyKey: "fixture-key",
		medOrgOrd: "fixture-main",
		chrgBchno: "fixture-batch",
		payOrdId: null,
		payTokenHash: null,
		status: "created",
		ordStas: null,
		amounts: null,
		setlType: null,
		revsTokenHash: null,
		revsTokenExpiresAt: null,
		lastError: null,
		version: 7,
		createdAt: "2026-10-17T01:00:00.000Z",
		updatedAt: "2026-10-17T01:00:00.000Z",
	};
	await repository.insert(order);
	const latest = { ...context, feeUploadStage: "pre_6201" as const };
	await repository.saveSettlementContext(
		order.ownerUserId,
		order.medicalOrderId,
		latest,
		7,
	);
	await expect(
		repository.saveSettlementContext(
			order.ownerUserId,
			order.medicalOrderId,
			context,
			6,
		),
	).rejects.toThrow("context order is unavailable");
	expect(
		await repository.getSettlementContext(
			order.ownerUserId,
			order.medicalOrderId,
		),
	).toEqual(latest);
	expect(
		(await repository.findByMedicalOrderId(order.medicalOrderId))?.version,
	).toBe(7);
});
