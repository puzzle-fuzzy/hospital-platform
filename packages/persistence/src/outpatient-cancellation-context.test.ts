import { expect, test } from "bun:test";
import type { RegistrationSelfPaySettlementContext } from "@hospital/domain";
import type { Pool } from "mysql2/promise";
import { createMySqlRepositories } from "./mysql-repositories";
import { createAesGcmSecretValueCipher } from "./prepay-cipher";

function fixture() {
	const values: unknown[][] = [];
	const responses: unknown[] = [];
	const pool = {
		async execute(_sql: string, input: unknown[]) {
			values.push(input);
			return [responses.shift() ?? { affectedRows: 1 }, []];
		},
	} as unknown as Pool;
	const cipher = createAesGcmSecretValueCipher(
		Buffer.alloc(32, 17).toString("base64"),
	);
	const repo = createMySqlRepositories(pool, {
		prepayCipher: cipher,
	}).paymentOrders;
	const save = repo.saveRegistrationSelfPayContext;
	const read = repo.getRegistrationSelfPayContext;
	if (!save || !read) throw new Error("Context persistence is required");
	return { values, responses, cipher, save, read };
}

function context(): RegistrationSelfPaySettlementContext {
	return {
		businessId: "8844000000000000001",
		payingId: "8844000000000000002",
		tradingId: "8844000000000000003",
		tradeTypeCode: "2",
		hospitalId: "test-hospital",
		patientId: "synthetic-patient",
		certNo: "synthetic-id",
		psnCertType: "01",
		psnName: "合成测试患者",
		psnNo: "synthetic-person",
		patInHosId: "synthetic-visit",
		outTradeNo: "synthetic-merchant-order",
		recordCode: "a".repeat(32),
		payTypeId: "5032",
		payType: "CREDIT",
		workStationId: "",
		outpatientCancellation: {
			state: "requested",
			requestedAt: "2026-10-21T01:00:00.000Z",
		},
	};
}

test.each(["requested", "awaiting_confirmation", "cancelled", "paid"] as const)(
	"outpatient cancellation marker is encrypted and round trips in state %s",
	async (state) => {
		const f = fixture(),
			value = context();
		value.outpatientCancellation = {
			state,
			requestedAt: "2026-10-21T01:00:00.000Z",
		};
		await f.save("owner", "order", value);
		const ciphertext = f.values[0]?.[0];
		if (typeof ciphertext !== "string")
			throw new Error("Ciphertext is required");
		expect(ciphertext).not.toContain(value.businessId);
		expect(ciphertext).not.toContain("outpatientCancellation");
		f.responses.push([
			{ registration_self_pay_context_ciphertext: ciphertext },
		]);
		await expect(f.read("owner", "order")).resolves.toEqual(value);
		expect(f.values[1]).toEqual(["owner", "order"]);
	},
);

test.each([
	{ state: "success", requestedAt: "2026-10-21T01:00:00.000Z" },
	{ state: ["cancelled"], requestedAt: "2026-10-21T01:00:00.000Z" },
	{ state: "cancelled", requestedAt: "2026-02-30T01:00:00.000Z" },
	{ state: "cancelled", requestedAt: "2026-10-21 09:00:00" },
	{
		state: "cancelled",
		requestedAt: "2026-10-21T01:00:00.000Z",
		businessId: "injected",
	},
	null,
])(
	"invalid cancellation marker fails before persistence or Provider work: %j",
	async (marker) => {
		const f = fixture();
		await expect(
			f.save("owner", "order", {
				...context(),
				outpatientCancellation: marker,
			} as RegistrationSelfPaySettlementContext),
		).rejects.toThrow("self-pay context is invalid");
		expect(f.values).toHaveLength(0);
	},
);

test("outpatient cancellation marker cannot be attached to registration context", async () => {
	const f = fixture();
	await expect(
		f.save("owner", "order", {
			...context(),
			tradeTypeCode: "10",
		}),
	).rejects.toThrow("self-pay context is invalid");
	expect(f.values).toHaveLength(0);
});

test.each([
	{ state: "cancelled", requestedAt: "not-a-date" },
	{ state: ["cancelled"], requestedAt: "2026-10-21T01:00:00.000Z" },
])(
	"an invalid stored marker is rejected when decrypting an existing context: %j",
	async (marker) => {
		const f = fixture();
		const invalid = {
			...context(),
			outpatientCancellation: marker,
		};
		f.responses.push([
			{
				registration_self_pay_context_ciphertext: f.cipher.seal(
					JSON.stringify(invalid),
				),
			},
		]);
		await expect(f.read("owner", "order")).rejects.toThrow(
			"self-pay context is invalid",
		);
		expect(f.values).toHaveLength(1);
	},
);
