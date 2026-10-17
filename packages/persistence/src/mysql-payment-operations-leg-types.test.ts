import { expect, test } from "bun:test";
import { PAYMENT_LEG_TYPES, type PaymentLeg } from "@hospital/domain";
import type { Pool } from "mysql2/promise";
import { createMySqlRepositories } from "./mysql-repositories";

function fixture() {
	const rows = new Map<string, Record<string, unknown>>();
	const statements: string[] = [];
	const columns = [
		"leg_id",
		"aggregate_id",
		"leg_type",
		"source",
		"source_order_id",
		"amount_fen",
		"status",
		"provider_reference_digest",
		"confirmed_at",
		"version",
		"created_at",
		"updated_at",
	];
	const pool = {
		async execute(sql: string, values: readonly unknown[] = []) {
			statements.push(sql);
			if (sql.startsWith("SELECT") && sql.includes("FROM hp_payment_legs")) {
				return [
					[...rows.values()].filter(
						(row) =>
							row.aggregate_id === values[0] &&
							(!sql.includes("AND leg_type = ?") || row.leg_type === values[1]),
					),
					[],
				];
			}
			if (sql.startsWith("INSERT INTO hp_payment_legs")) {
				rows.set(
					String(values[0]),
					Object.fromEntries(
						columns.map((column, index) => [column, values[index]]),
					),
				);
				return [{ affectedRows: 1 }, []];
			}
			if (sql.startsWith("UPDATE hp_payment_legs")) {
				const row = rows.get(String(values[8]));
				if (!row || row.version !== values[9]) return [{ affectedRows: 0 }, []];
				for (const [index, column] of [
					"source",
					"source_order_id",
					"amount_fen",
					"status",
					"provider_reference_digest",
					"confirmed_at",
					"version",
					"updated_at",
				].entries())
					row[column] = values[index];
				return [{ affectedRows: 1 }, []];
			}
			throw new Error("Unexpected ledger fixture SQL");
		},
	} as unknown as Pool;
	return {
		repository: createMySqlRepositories(pool).paymentOperations,
		rows,
		statements,
	};
}

for (const legType of PAYMENT_LEG_TYPES) {
	test.each([0, 200])(
		`MySQL ledger ${legType} INSERT, listLegs and CAS UPDATE roundtrip: %d fen`,
		async (amountFen) => {
			const { repository, statements } = fixture();
			const leg: PaymentLeg = {
				legId: `fixture-${legType}`,
				aggregateId: "fixture-aggregate",
				legType,
				source:
					legType === "medical_insurance"
						? "medical_insurance"
						: legType === "wechat_cash"
							? "wechat_pay"
							: "platform",
				sourceOrderId: "fixture-order",
				amountFen,
				status:
					amountFen === 0
						? "not_started"
						: legType === "unallocated"
							? "manual_review"
							: "confirmed",
				version: 1,
				createdAt: "2026-10-17T01:00:00.000Z",
				updatedAt: "2026-10-17T01:00:00.000Z",
			};
			await repository.upsertLeg(leg);
			expect(await repository.listLegs(leg.aggregateId)).toEqual([leg]);
			const updated = {
				...leg,
				version: 2,
				updatedAt: "2026-10-17T01:01:00.000Z",
			};
			// upsertLeg first parses the persisted existing row before the CAS update.
			await repository.upsertLeg(updated, 1);
			expect(await repository.listLegs(leg.aggregateId)).toEqual([updated]);
			expect(statements.filter((sql) => sql.startsWith("INSERT"))).toHaveLength(
				1,
			);
			expect(statements.filter((sql) => sql.startsWith("UPDATE"))).toHaveLength(
				1,
			);
		},
	);
}

test("MySQL listLegs retains both new zero-valued legs alongside all original ledger legs", async () => {
	const { repository } = fixture();
	for (const legType of PAYMENT_LEG_TYPES)
		await repository.upsertLeg({
			legId: `fixture-${legType}`,
			aggregateId: "fixture-all-legs",
			legType,
			source: "platform",
			sourceOrderId: "fixture-order",
			amountFen: 0,
			status: "not_started",
			version: 1,
			createdAt: "2026-10-17T01:00:00.000Z",
			updatedAt: "2026-10-17T01:00:00.000Z",
		});
	expect(
		(await repository.listLegs("fixture-all-legs")).map((leg) => leg.legType),
	).toEqual([...PAYMENT_LEG_TYPES]);
});

test("MySQL listLegs still rejects an unknown persisted leg type", async () => {
	const { repository, rows } = fixture();
	rows.set("invalid-leg", {
		aggregate_id: "fixture-invalid",
		leg_type: "not-a-contract-leg",
	});
	await expect(repository.listLegs("fixture-invalid")).rejects.toThrow(
		"unknown payment leg type",
	);
});
