import { afterAll, beforeAll, expect, test } from "bun:test";
import {
	HisPaymentReferenceConflictError,
	HisPaymentReferenceNotInitializedError,
} from "@hospital/domain";
import { createPool, type Pool } from "mysql2/promise";
import { createMySqlHisPaymentReferenceRepository } from "./his-payment-references";
import { createMySqlRepositories } from "./mysql-repositories";

// 只允许显式指定本任务的隔离本地数据库；默认包测试不会访问数据库。
const url = Bun.env.HIS_REFERENCE_TEST_DATABASE_URL;
const mysqlTest = test.skipIf(!url);
let pool: Pool;
const scope = {
	ownerUserId: "his-ref-test-owner",
	medicalOrderId: "his-ref-test-order",
	paymentScopeId: "cash-one",
	source: "component" as const,
};

beforeAll(async () => {
	if (!url) return;
	const target = new URL(url);
	if (
		target.hostname !== "127.0.0.1" ||
		target.pathname !== "/hospital_his_reference_test"
	)
		throw new Error("Only the isolated HIS reference test database is allowed");
	pool = createPool({ uri: url, connectionLimit: 8, dateStrings: true });
	await pool.execute(
		"INSERT INTO hp_identity_users (user_id, provider_subject, union_id, created_at, updated_at) VALUES (?, 'his-ref-test-provider', ?, NOW(3), NOW(3))",
		[scope.ownerUserId, "his-ref-test-union"],
	);
	await pool.execute(
		"INSERT INTO hp_patients (patient_id, owner_user_id, display_name, relationship, card_number_masked, source, created_at, updated_at) VALUES ('his-ref-test-patient', ?, 'test', 'self', 'test', 'test', NOW(3), NOW(3))",
		[scope.ownerUserId],
	);
	await pool.execute(
		"INSERT INTO hp_medical_insurance_orders (medical_order_id, owner_user_id, patient_id, idempotency_key, med_org_ord, chrg_bchno, status, version, created_at, updated_at) VALUES (?, ?, 'his-ref-test-patient', 'his-ref-test-key', ?, 'his-ref-test-charge', 'created', 1, NOW(3), NOW(3))",
		[scope.medicalOrderId, scope.ownerUserId, scope.medicalOrderId],
	);
});

afterAll(async () => {
	if (!pool) return;
	try {
		await pool.execute(
			"DELETE r FROM hp_his_payment_references r INNER JOIN hp_his_payment_reference_scopes s ON s.allocation_id = r.allocation_id WHERE s.medical_order_id = ?",
			[scope.medicalOrderId],
		);
		await pool.execute(
			"DELETE FROM hp_his_payment_reference_scopes WHERE medical_order_id = ?",
			[scope.medicalOrderId],
		);
		await pool.execute(
			"DELETE FROM hp_medical_insurance_orders WHERE medical_order_id = ?",
			[scope.medicalOrderId],
		);
		await pool.execute(
			"DELETE FROM hp_patients WHERE patient_id = 'his-ref-test-patient' AND owner_user_id = ?",
			[scope.ownerUserId],
		);
		await pool.execute("DELETE FROM hp_identity_users WHERE user_id = ?", [
			scope.ownerUserId,
		]);
	} finally {
		await pool.end();
	}
});

mysqlTest(
	"MySQL historical aliases, initialization gate, concurrent allocations and durable quarantine",
	async () => {
		const repository = createMySqlHisPaymentReferenceRepository(pool);
		const [counts] = await pool.query<import("mysql2/promise").RowDataPacket[]>(
			"SELECT COUNT(*) AS total FROM hp_his_payment_references",
		);
		expect(Number(counts[0]?.total)).toBe(0);
		await pool.execute(
			"UPDATE hp_his_payment_reference_allocator SET initialized = 0, next_reference_id = 1, initialized_at = NULL WHERE singleton_id = 1",
		);
		await expect(repository.allocate(scope)).rejects.toBeInstanceOf(
			HisPaymentReferenceNotInitializedError,
		);
		const historicalA = { ...scope, paymentScopeId: "historical-a" };
		const historicalB = { ...scope, paymentScopeId: "historical-b" };
		const firstHistorical = await repository.confirm({
			...historicalA,
			referenceId: "2",
		});
		expect(firstHistorical.requestReferenceId).toBeUndefined();
		expect(firstHistorical.referenceId).toBe("2");
		expect(await repository.findByReferenceId("1")).toBeUndefined();
		const secondHistorical = await repository.confirm({
			...historicalB,
			referenceId: "1",
		});
		expect(secondHistorical.requestReferenceId).toBeUndefined();
		expect(await repository.findByReferenceId("2")).toEqual(firstHistorical);
		expect(await repository.findByReferenceId("1")).toEqual(secondHistorical);
		const maximumHistorical = { ...scope, paymentScopeId: "historical-max" };
		await repository.confirm({
			...maximumHistorical,
			referenceId: "9223372036854775807",
		});
		await repository.initializeNewNumbering();
		const records = await Promise.all(
			Array.from({ length: 16 }, () => repository.allocate(scope)),
		);
		const allocated = records[0];
		if (!allocated) throw new Error("Allocation missing");
		expect(new Set(records.map((record) => record.referenceId)).size).toBe(1);
		expect(allocated.status).toBe("allocated");
		expect(allocated.requestReferenceId).toBe("3");
		const confirmed = await repository.confirm({
			...scope,
			referenceId: "9007199254740993",
		});
		expect(confirmed.receiptId).toBe("9007199254740993");
		expect(await repository.findByReferenceId(allocated.referenceId)).toEqual(
			confirmed,
		);
		expect(await repository.findByReferenceId("9007199254740993")).toEqual(
			confirmed,
		);
		expect(await repository.findByScope(scope)).toEqual(confirmed);
		expect(
			await repository.findByScope({ ...scope, ownerUserId: "wrong-owner" }),
		).toBeUndefined();
		await expect(
			repository.confirm({
				...scope,
				referenceId: "9007199254740994",
			}),
		).rejects.toBeInstanceOf(HisPaymentReferenceConflictError);
		expect(await repository.findByReferenceId("3")).toEqual(confirmed);
		await repository.confirm({
			...maximumHistorical,
			referenceId: "9223372036854775807",
		});
		const [sequenceBefore] = await pool.query<
			import("mysql2/promise").RowDataPacket[]
		>(
			"SELECT CAST(next_reference_id AS CHAR) AS next_id FROM hp_his_payment_reference_allocator WHERE singleton_id = 1",
		);
		expect(sequenceBefore[0]?.next_id).toBe("4");
		await expect(
			repository.allocate({ ...scope, ownerUserId: "wrong-owner" }),
		).rejects.toThrow();
		await expect(
			repository.confirm({ ...scope, referenceId: "9223372036854775808" }),
		).rejects.toThrow();
		// 连续 32 个真实历史号占用下一个公开号；一次分配必须直接找到空位。
		for (let i = 4; i <= 35; i++)
			await repository.confirm({
				...scope,
				paymentScopeId: `historical-contiguous-${i}`,
				referenceId: String(i),
			});
		const next = await repository.allocate({
			...scope,
			paymentScopeId: "skip-reserved",
		});
		expect(next.requestReferenceId).toBe("36");
		const collisionA = await repository.confirm({
			...scope,
			paymentScopeId: "skip-reserved",
			referenceId: "4000",
		});
		const collisionB = { ...scope, paymentScopeId: "collision-b" };
		await expect(
			repository.confirm({ ...collisionB, referenceId: "36" }),
		).rejects.toBeInstanceOf(HisPaymentReferenceConflictError);
		await expect(repository.findByReferenceId("36")).rejects.toBeInstanceOf(
			HisPaymentReferenceConflictError,
		);
		await expect(
			repository.allocate({ ...scope, paymentScopeId: "skip-reserved" }),
		).rejects.toBeInstanceOf(HisPaymentReferenceConflictError);
		expect(await repository.findByReferenceId("4000")).toEqual(collisionA);
		expect(await repository.findByScope(collisionB)).toBeUndefined();
		const [quarantine] = await pool.query<
			import("mysql2/promise").RowDataPacket[]
		>(
			"SELECT conflicted FROM hp_his_payment_references WHERE reference_id = 36",
		);
		expect(Number(quarantine[0]?.conflicted)).toBe(1);
		await expect(repository.initializeNewNumbering()).rejects.toBeInstanceOf(
			HisPaymentReferenceConflictError,
		);
		await repository.quarantineReferenceId("2");
		await expect(repository.findByReferenceId("2")).rejects.toBeInstanceOf(
			HisPaymentReferenceConflictError,
		);
		await repository.quarantineReferenceId("9999999");
		expect(await repository.findByReferenceId("9999999")).toBeUndefined();
		const orders = createMySqlRepositories(pool, {
			medicalInsuranceCredentialEncryptionKey: Buffer.alloc(32, 9).toString(
				"base64",
			),
		}).medicalInsuranceOrders;
		await orders.saveSettlementContext(
			scope.ownerUserId,
			scope.medicalOrderId,
			{
				businessId: "test-business",
				hospitalId: "test-hospital",
				patientId: "test-patient",
				networkRegister: {},
				outNetworkSettleMain: {},
				nationalUpDetailList: [],
				upDetailList: [],
				tradeOrderIds: ["test-trade"],
				plugin: {
					paymentOrderId: "test-payment",
					payingId: "test-paying",
					tradingId: "test-trading",
					payTypeId: "5027",
					payType: "CREDIT",
					workStationId: "",
					tradeCode: "test-trade",
					tradeTypeCode: "10",
					outTradeNo: "test-wx-original",
					recordCode: "0123456789abcdef0123456789abcdef",
					state: "cash_paid",
				},
			},
		);
		const attempt = {
			ownerUserId: scope.ownerUserId,
			medicalOrderId: scope.medicalOrderId,
			paymentOrderId: "test-payment",
			outTradeNo: "test-wx-original",
			attemptedAt: "2026-10-15T10:00:00.000Z",
		};
		expect(
			await orders.claimPluginThirdPartPayAttempt({
				...attempt,
				outTradeNo: "another-payment",
			}),
		).toBe(false);
		const claims = await Promise.all(
			Array.from({ length: 16 }, () =>
				orders.claimPluginThirdPartPayAttempt(attempt),
			),
		);
		expect(claims.filter(Boolean)).toHaveLength(1);
		expect(
			(
				await orders.getSettlementContext(
					scope.ownerUserId,
					scope.medicalOrderId,
				)
			)?.plugin?.thirdPartPayAttempt?.status,
		).toBe("unknown");
		expect(await orders.claimPluginThirdPartPayAttempt(attempt)).toBe(false);
	},
	20_000,
);
