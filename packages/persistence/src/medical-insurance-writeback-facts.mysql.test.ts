import { afterAll, beforeAll, expect, test } from "bun:test";
import type { MedicalInsuranceSettlementContext } from "@hospital/domain";
import { createPool, type Pool } from "mysql2/promise";
import { createMySqlRepositories } from "./mysql-repositories";

const url = Bun.env.HIS_REFERENCE_TEST_DATABASE_URL;
const mysqlTest = test.skipIf(!url);
const owner = "his-writeback-review-owner";
const roots: string[] = [];
let pool: Pool;
let repositories: ReturnType<typeof createMySqlRepositories>;

beforeAll(async () => {
	if (!url) return;
	const target = new URL(url);
	if (
		target.hostname !== "127.0.0.1" ||
		target.pathname !== "/hospital_his_reference_test"
	)
		throw new Error("Only the isolated HIS reference test database is allowed");
	pool = createPool({ uri: url, connectionLimit: 8, dateStrings: true });
	repositories = createMySqlRepositories(pool, {
		medicalInsuranceCredentialEncryptionKey: Buffer.alloc(32, 6).toString(
			"base64",
		),
	});
	await pool.execute(
		"INSERT INTO hp_identity_users (user_id, provider_subject, created_at, updated_at) VALUES (?, ?, NOW(3), NOW(3))",
		[owner, owner],
	);
	await pool.execute(
		"INSERT INTO hp_patients (patient_id, owner_user_id, display_name, relationship, card_number_masked, source, created_at, updated_at) VALUES ('his-writeback-review-patient', ?, 'test', 'self', 'test', 'test', NOW(3), NOW(3))",
		[owner],
	);
});

afterAll(async () => {
	if (!pool) return;
	try {
		for (const id of roots)
			await pool.execute(
				"DELETE FROM hp_medical_insurance_orders WHERE medical_order_id = ? AND owner_user_id = ?",
				[id, owner],
			);
		await pool.execute(
			"DELETE FROM hp_patients WHERE patient_id = 'his-writeback-review-patient' AND owner_user_id = ?",
			[owner],
		);
		await pool.execute("DELETE FROM hp_identity_users WHERE user_id = ?", [
			owner,
		]);
	} finally {
		await pool.end();
	}
});

async function fixture(kind: "plugin" | "component") {
	const id = `writeback-${crypto.randomUUID()}`;
	const outTradeNo = `original-wx-${kind}`;
	roots.push(id);
	await pool.execute(
		"INSERT INTO hp_medical_insurance_orders (medical_order_id, owner_user_id, patient_id, idempotency_key, med_org_ord, chrg_bchno, status, version, wechat_out_trade_no, wechat_payment_state, created_at, updated_at) VALUES (?, ?, 'his-writeback-review-patient', ?, ?, ?, 'insurance_settled', 1, ?, 'cash_paid', NOW(3), NOW(3))",
		[id, owner, id, id, id, outTradeNo],
	);
	const context: MedicalInsuranceSettlementContext = {
		businessId: "his-writeback-business",
		hospitalId: "his-writeback-hospital",
		patientId: "his-writeback-patient",
		networkRegister: {},
		outNetworkSettleMain: {},
		nationalUpDetailList: [],
		upDetailList: [],
		tradeOrderIds: [],
		...(kind === "plugin"
			? {
					plugin: {
						paymentOrderId: "original-payment",
						payingId: "11",
						tradingId: "12",
						payTypeId: "5031",
						payType: "CREDIT" as const,
						workStationId: "",
						tradeCode: "original-trade",
						tradeTypeCode: "10",
						outTradeNo,
						recordCode: "0123456789abcdef0123456789abcdef",
						state: "cash_paid" as const,
					},
				}
			: {
					postPaymentComponents: [
						{
							componentId: "original-component",
							kind: "wechat_cash" as const,
							totalFen: 100,
							amountFen: 100,
							payModel: "H5" as const,
							payTypeId: "5031" as const,
							recordCode: "0123456789abcdef0123456789abcdef",
							state: "succeeded" as const,
							attempts: 1,
							payingId: "11",
							tradingId: "12",
							updatedAt: "2026-10-15T00:00:00.000Z",
						},
					],
				}),
	};
	const orders = repositories.medicalInsuranceOrders;
	await orders.saveSettlementContext(owner, id, context);
	const attempt = {
		ownerUserId: owner,
		medicalOrderId: id,
		outTradeNo,
		attemptedAt: "2026-10-15T00:00:00.000Z",
	};
	return {
		id,
		context,
		orders,
		attempt,
		read: () => orders.getSettlementContext(owner, id),
	};
}

mysqlTest(
	"MySQL late plugin snapshots preserve claim and receipt across concurrent writers",
	async () => {
		const f = await fixture("plugin");
		const claim = () =>
			f.orders.claimPluginThirdPartPayAttempt({
				...f.attempt,
				paymentOrderId: "original-payment",
			});
		const results = await Promise.all(Array.from({ length: 16 }, claim));
		expect(results.filter(Boolean)).toHaveLength(1);
		await f.orders.saveSettlementContext(owner, f.id, f.context);
		expect((await f.read())?.plugin?.thirdPartPayAttempt?.status).toBe(
			"unknown",
		);
		expect(await claim()).toBe(false);
		const current = await f.read();
		if (!current?.plugin) throw new Error("Plugin missing");
		await f.orders.saveSettlementContext(owner, f.id, {
			...current,
			plugin: {
				...current.plugin,
				state: "29_succeeded",
				thirdPartPayRecordId: "9007199254740993",
				thirdPartPayAttempt: {
					attemptedAt: f.attempt.attemptedAt,
					status: "succeeded",
				},
			},
		});
		await f.orders.saveSettlementContext(owner, f.id, f.context);
		expect((await f.read())?.plugin).toMatchObject({
			state: "29_succeeded",
			thirdPartPayRecordId: "9007199254740993",
			thirdPartPayAttempt: { status: "succeeded" },
		});
		await expect(
			f.orders.saveSettlementContext(owner, f.id, {
				...f.context,
				plugin: { ...current.plugin, paymentOrderId: "replacement-payment" },
			}),
		).rejects.toThrow();
		expect((await f.read())?.plugin?.paymentOrderId).toBe("original-payment");
	},
	20_000,
);

mysqlTest(
	"MySQL cash component claim survives lease overlap and stale context writes",
	async () => {
		const f = await fixture("component");
		const claim = () =>
			f.orders.claimSelfPayThirdPartPayAttempt({
				...f.attempt,
				componentId: "original-component",
			});
		expect(
			await f.orders.claimSelfPayThirdPartPayAttempt({
				...f.attempt,
				componentId: "different-component",
			}),
		).toBe(false);
		const results = await Promise.all(Array.from({ length: 16 }, claim));
		expect(results.filter(Boolean)).toHaveLength(1);
		await f.orders.saveSettlementContext(owner, f.id, f.context);
		expect((await f.read())?.selfPayThirdPartyWriteback).toMatchObject({
			status: "unknown",
			outTradeNo: f.attempt.outTradeNo,
		});
		expect(await claim()).toBe(false);
		const current = await f.read();
		if (!current) throw new Error("Context missing");
		await f.orders.saveSettlementContext(owner, f.id, {
			...current,
			selfPayThirdPartyWriteback: {
				attemptedAt: f.attempt.attemptedAt,
				status: "succeeded",
				thirdPartPayRecordId: "9007199254740995",
			},
		});
		await f.orders.saveSettlementContext(owner, f.id, f.context);
		expect((await f.read())?.selfPayThirdPartyWriteback).toMatchObject({
			status: "succeeded",
			thirdPartPayRecordId: "9007199254740995",
			outTradeNo: f.attempt.outTradeNo,
		});
		expect(await claim()).toBe(false);
		await expect(
			f.orders.saveSettlementContext(owner, f.id, {
				...f.context,
				postPaymentComponents:
					f.context.postPaymentComponents?.map((c) => ({
						...c,
						componentId: "replacement-component",
					})) ?? [],
			}),
		).rejects.toThrow();
		expect((await f.read())?.postPaymentComponents?.[0]?.componentId).toBe(
			"original-component",
		);
	},
	20_000,
);
