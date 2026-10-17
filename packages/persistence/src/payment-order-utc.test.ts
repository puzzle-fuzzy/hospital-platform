import { expect, test } from "bun:test";
import { fileURLToPath } from "node:url";
import type { MedicalInsuranceSettlementContext } from "@hospital/domain";
import type { Pool } from "mysql2/promise";
import { createMySqlRepositories } from "./mysql-repositories";
import { createAesGcmSecretValueCipher } from "./prepay-cipher";

const paymentRow = {
	order_id: "utc-payment-order",
	owner_user_id: "utc-owner",
	patient_id: "utc-patient",
	idempotency_key: "utc-payment-key",
	total_fen: 1000,
	insurance_fen: 0,
	cash_fen: 1000,
	state: "completed",
	version: 1,
	created_at: "2026-10-15 15:59:59.123",
	updated_at: "2026-10-15 16:00:00.456",
};

function fakePool(responses: unknown[]) {
	const statements: string[] = [];
	const values: (readonly unknown[])[] = [];
	const connection = {
		async beginTransaction() {},
		async commit() {},
		async rollback() {},
		release() {},
		async execute(sql: string, parameters: readonly unknown[] = []) {
			statements.push(sql);
			values.push(parameters);
			if (!responses.length) throw new Error("Unexpected UTC test SQL");
			return [responses.shift(), []];
		},
	};
	const pool = {
		...connection,
		async getConnection() {
			return connection;
		},
	} as unknown as Pool;
	return { pool, statements, values };
}

test("ordinary payment timestamps are UTC ISO and sort consistently with medical order timestamps", async () => {
	const ordinary = await createMySqlRepositories(
		fakePool([[paymentRow]]).pool,
	).paymentOrders.findById(paymentRow.order_id);
	const medical = await createMySqlRepositories(
		fakePool([
			[
				{
					medical_order_id: "utc-medical-order",
					owner_user_id: "utc-owner",
					patient_id: "utc-patient",
					business_type: "outpatient",
					order_type: "DiagPay",
					idempotency_key: "utc-medical-key",
					med_org_ord: "utc-med-org",
					chrg_bchno: "utc-batch",
					status: "insurance_settled",
					ord_stas: "6",
					total_fen: 1000,
					cash_fen: 0,
					personal_account_fen: 0,
					fund_fen: 1000,
					wechat_payment_state: "not_started",
					version: 1,
					created_at: "2026-10-15 00:00:00.000",
					updated_at: "2026-10-15 01:00:00.000",
				},
			],
		]).pool,
	).medicalInsuranceOrders.findByMedicalOrderId("utc-medical-order");
	if (!ordinary || !medical) throw new Error("UTC fixture missing");
	expect(ordinary.createdAt).toBe("2026-10-15T15:59:59.123Z");
	expect(ordinary.updatedAt).toBe("2026-10-15T16:00:00.456Z");
	expect(medical.updatedAt).toBe("2026-10-15T01:00:00.000Z");
	expect(
		[medical.updatedAt, ordinary.updatedAt].sort((left, right) =>
			right.localeCompare(left),
		),
	).toEqual([ordinary.updatedAt, medical.updatedAt]);
});

test("ordinary payment rejects malformed database DATETIME instead of guessing a local timezone", async () => {
	const repository = createMySqlRepositories(
		fakePool([[{ ...paymentRow, updated_at: "2026-02-30 01:00:00.000" }]]).pool,
	).paymentOrders;
	await expect(repository.findById(paymentRow.order_id)).rejects.toThrow(
		"invalid appointment timestamp",
	);
});

for (const timezone of ["UTC", "Asia/Shanghai", "America/Los_Angeles"]) {
	test(`payment UTC read, write and backfill cursor roundtrip is independent of process TZ=${timezone}`, async () => {
		const modulePath = fileURLToPath(
			new URL("./mysql-repositories.ts", import.meta.url),
		);
		const script = `
import { createMySqlRepositories } from ${JSON.stringify(modulePath)};
const row = ${JSON.stringify(paymentRow)};
const queries = [], values = [], responses = [[row], {affectedRows:1}, {affectedRows:1}, []];
const connection = {
  beginTransaction: async () => {}, commit: async () => {}, rollback: async () => {}, release: () => {},
  execute: async (sql, parameters=[]) => { queries.push(sql); values.push(parameters); if (!responses.length) throw new Error('Unexpected SQL'); return [responses.shift(),[]]; }
};
const pool = {...connection,getConnection:async()=>connection};
const repo = createMySqlRepositories(pool).paymentOrders;
const order = await repo.findById(row.order_id);
await repo.update({...order,version:2},1,{eventId:'utc-event',eventName:'payment.updated',aggregateId:row.order_id,payload:{},occurredAt:order.updatedAt,availableAt:order.updatedAt,status:'pending',attempts:0});
await repo.listForPaymentOperationsBackfill({limit:10,afterCreatedAt:order.createdAt,afterSourceOrderId:order.orderId});
console.log(JSON.stringify({createdAt:order.createdAt,updatedAt:order.updatedAt,writtenUpdatedAt:values[1][2],backfillCursor:values[3].slice(0,2),offset:new Date('2026-10-15T16:00:00Z').getTimezoneOffset()}));
`;
		const processResult = Bun.spawn([process.execPath, "--eval", script], {
			env: { ...process.env, TZ: timezone },
			stdout: "pipe",
			stderr: "pipe",
		});
		const [stdout, stderr, exitCode] = await Promise.all([
			new Response(processResult.stdout).text(),
			new Response(processResult.stderr).text(),
			processResult.exited,
		]);
		expect(stderr).toBe("");
		expect(exitCode).toBe(0);
		expect(JSON.parse(stdout)).toEqual({
			createdAt: "2026-10-15T15:59:59.123Z",
			updatedAt: "2026-10-15T16:00:00.456Z",
			writtenUpdatedAt: "2026-10-15 16:00:00.456",
			backfillCursor: ["2026-10-15 15:59:59.123", "2026-10-15 15:59:59.123"],
			offset:
				timezone === "UTC" ? 0 : timezone === "Asia/Shanghai" ? -480 : 420,
		});
	});
}

test("ordinary and medical context mutations plus settlement update use UTC database time", async () => {
	const state = fakePool([
		{ affectedRows: 1 },
		{ affectedRows: 1 },
		{ affectedRows: 1 },
		{ affectedRows: 0 },
	]);
	const cipher = createAesGcmSecretValueCipher(
		Buffer.alloc(32, 23).toString("base64"),
	);
	const repositories = createMySqlRepositories(state.pool, {
		prepayCipher: cipher,
		medicalInsuranceCredentialCipher: cipher,
	});
	const context: MedicalInsuranceSettlementContext = {
		businessId: "utc-business",
		hospitalId: "utc-hospital",
		patientId: "utc-patient",
		networkRegister: {},
		outNetworkSettleMain: {},
		nationalUpDetailList: [],
		upDetailList: [],
		tradeOrderIds: [],
	};
	const saveOrdinary =
		repositories.paymentOrders.saveRegistrationSelfPayContext;
	if (!saveOrdinary) throw new Error("ordinary context writer missing");
	await saveOrdinary("utc-owner", "utc-order", {
		businessId: "utc-business",
		payingId: "utc-paying",
		tradingId: "utc-trading",
		hospitalId: "utc-hospital",
		patientId: "utc-patient",
		certNo: "synthetic-certificate",
		psnCertType: "01",
		psnName: "synthetic-name",
		psnNo: "synthetic-person",
		patInHosId: "0",
		outTradeNo: "utc-out-trade",
		recordCode: "utc-record",
		payTypeId: "5032",
		payType: "CREDIT",
		workStationId: "",
	});
	await repositories.medicalInsuranceOrders.saveSettlementContext(
		"utc-owner",
		"utc-medical",
		context,
	);
	await repositories.medicalInsuranceOrders.saveSettlementContextIfMissing(
		"utc-owner",
		"utc-medical",
		context,
	);
	await repositories.medicalInsuranceOrders.applySettlement("utc-medical", 7, {
		status: "cash_pending",
		ordStas: "4",
		amounts: null,
		setlType: null,
		revsTokenHash: null,
		revsTokenExpiresAt: null,
	});
	expect(state.statements).toHaveLength(4);
	for (const sql of state.statements) {
		expect(sql).toContain("updated_at = UTC_TIMESTAMP(3)");
		expect(sql).not.toContain("NOW(3)");
	}
	expect(state.statements[0]).toContain(
		"WHERE owner_user_id = ? AND order_id = ?",
	);
	expect(state.values[0]?.slice(-2)).toEqual(["utc-owner", "utc-order"]);
	expect(state.statements[1]).toContain(
		"WHERE medical_order_id = ? AND owner_user_id = ?",
	);
	expect(state.statements[2]).toContain(
		"AND settlement_context_ciphertext IS NULL",
	);
	expect(state.statements[3]).toContain(
		"WHERE medical_order_id = ? AND version = ?",
	);
	expect(state.values[3]?.slice(-2)).toEqual(["utc-medical", 7]);
});
