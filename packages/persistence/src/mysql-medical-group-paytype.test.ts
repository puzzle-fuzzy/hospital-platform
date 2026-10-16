import { expect, test } from "bun:test";
import type {
	MedicalInsurancePostPaymentComponent,
	MedicalInsuranceSettlementContext,
} from "@hospital/domain";
import type { Pool } from "mysql2/promise";
import { createMySqlRepositories } from "./mysql-repositories";
import { createAesGcmSecretValueCipher } from "./prepay-cipher";

type Parameter = NonNullable<
	MedicalInsurancePostPaymentComponent["payTypeParams"]
>[number];

const account: Parameter = {
	kind: "personal_account",
	payTypeId: "5",
	amountFen: 1000,
};
const fund: Parameter = { kind: "fund", payTypeId: "2", amountFen: 1000 };
const discount: Parameter = {
	kind: "hospital_reduce",
	payTypeId: "50",
	amountFen: 1000,
};

function medicalGroup(
	payTypeId: "2" | "5",
	state: MedicalInsurancePostPaymentComponent["state"],
	parameters: readonly Parameter[] = [account],
): MedicalInsurancePostPaymentComponent {
	return {
		componentId: "fixture-order:medical",
		kind: "medical",
		totalFen: 1000,
		amountFen: 1000,
		payModel: "H5",
		payTypeId,
		payTypeParams: parameters,
		recordCode: "0123456789abcdef0123456789abcdef",
		state,
		attempts: state === "pending" ? 0 : 1,
		updatedAt: "2026-10-16T06:33:18.000Z",
		...(state === "succeeded"
			? { payingId: "260650000000011", tradingId: "260650000000012" }
			: state === "failed"
				? { lastErrorCode: "trade-payment@0008" }
				: {}),
	};
}

async function saveAndRead(component: MedicalInsurancePostPaymentComponent) {
	const key = Buffer.alloc(32, 17).toString("base64");
	const cipher = createAesGcmSecretValueCipher(key, {
		keyName: "MEDICAL_INSURANCE_CREDENTIAL_ENCRYPTION_KEY",
		valueName: "medical insurance credential",
	});
	const statements: string[] = [];
	let stored = "";
	// Only SQL transport is stubbed: production repository serialization,
	// AES-GCM encryption/decryption and read validation all execute unchanged.
	const pool = {
		async execute(sql: string, values: readonly unknown[] = []) {
			statements.push(sql);
			if (sql.trimStart().startsWith("UPDATE hp_medical_insurance_orders")) {
				stored = String(values[0]);
				return [{ affectedRows: 1 }, []];
			}
			if (sql.trimStart().startsWith("SELECT settlement_context_ciphertext")) {
				return [[{ settlement_context_ciphertext: stored }], []];
			}
			throw new Error("Unexpected fixture SQL");
		},
	} as unknown as Pool;
	const repositories = createMySqlRepositories(pool, {
		medicalInsuranceCredentialEncryptionKey: key,
	});
	const context: MedicalInsuranceSettlementContext = {
		businessId: "fixture-business",
		hospitalId: "10389001",
		patientId: "fixture-patient",
		insuredAreaCode: "140581",
		businessCode: "fixture-trade",
		networkRegister: {},
		outNetworkSettleMain: {},
		nationalUpDetailList: [],
		upDetailList: [],
		tradeOrderIds: [],
		postPaymentPlanVersion: "sequenced-v1",
		postPaymentComponents: [component],
	};
	await repositories.medicalInsuranceOrders.saveSettlementContext(
		"fixture-owner",
		"fixture-order",
		context,
	);
	expect(stored).not.toContain(context.businessId);
	expect(JSON.parse(cipher.open(stored))).toEqual(context);
	return {
		context,
		statements,
		read: () =>
			repositories.medicalInsuranceOrders.getSettlementContext(
				"fixture-owner",
				"fixture-order",
			),
	};
}

test.each(["pending", "succeeded", "failed"] as const)(
	"MySQL AES save/get roundtrip accepts personal-account group 5 in %s state",
	async (state) => {
		const fixture = await saveAndRead(medicalGroup("5", state));
		await expect(fixture.read()).resolves.toEqual(fixture.context);
		expect(fixture.statements).toHaveLength(2);
	},
);

test("MySQL AES save/get roundtrip retains account 5 with hospital reduction", async () => {
	const fixture = await saveAndRead(
		medicalGroup("5", "pending", [
			{ ...account, amountFen: 800 },
			{ ...discount, amountFen: 200 },
		]),
	);
	await expect(fixture.read()).resolves.toEqual(fixture.context);
});

test.each(["pending", "succeeded", "failed"] as const)(
	"MySQL AES roundtrip preserves legacy outer 2/account 5 in %s state for recovery",
	async (state) => {
		const fixture = await saveAndRead(medicalGroup("2", state));
		await expect(fixture.read()).resolves.toEqual(fixture.context);
	},
);

test.each(["pending", "succeeded", "failed"] as const)(
	"MySQL AES roundtrip preserves historical discount-only outer 2 in %s state",
	async (state) => {
		const fixture = await saveAndRead(medicalGroup("2", state, [discount]));
		await expect(fixture.read()).resolves.toEqual(fixture.context);
	},
);

test("MySQL AES roundtrip retains fund group 2 and legacy combined group 2", async () => {
	for (const component of [
		medicalGroup("2", "pending", [fund]),
		{ ...medicalGroup("2", "succeeded"), kind: "combined" as const },
	]) {
		const fixture = await saveAndRead(component);
		await expect(fixture.read()).resolves.toEqual(fixture.context);
	}
});

test.each([
	{ name: "fund-only params", component: medicalGroup("5", "pending", [fund]) },
	{
		name: "positive fund plus account params",
		component: medicalGroup("5", "pending", [
			{ ...fund, amountFen: 200 },
			{ ...account, amountFen: 800 },
		]),
	},
	{
		name: "discount-only params",
		component: medicalGroup("5", "pending", [discount]),
	},
	{
		name: "account pay type with wrong component kind",
		component: medicalGroup("5", "pending", [{ ...account, kind: "fund" }]),
	},
	{
		name: "cash payment within medical group",
		component: medicalGroup("5", "pending", [
			{ ...account, amountFen: 800 },
			{ kind: "wechat_cash", payTypeId: "5033", amountFen: 200 },
		]),
	},
	{
		name: "group amount mismatch",
		component: medicalGroup("5", "pending", [{ ...account, amountFen: 999 }]),
	},
	{
		name: "zero account amount",
		component: medicalGroup("5", "pending", [{ ...account, amountFen: 0 }]),
	},
	{
		name: "negative account amount",
		component: medicalGroup("5", "pending", [{ ...account, amountFen: -1 }]),
	},
	{
		name: "combined group 5 remains unsupported",
		component: { ...medicalGroup("5", "pending"), kind: "combined" as const },
	},
	{
		name: "MINI_PROGRAM medical group remains unsupported",
		component: {
			...medicalGroup("5", "pending"),
			payModel: "MINI_PROGRAM" as const,
		},
	},
])(
	"MySQL AES roundtrip rejects invalid group 5: $name",
	async ({ component }) => {
		const fixture = await saveAndRead(component);
		await expect(fixture.read()).rejects.toThrow(
			"Medical insurance settlement context is invalid",
		);
	},
);
