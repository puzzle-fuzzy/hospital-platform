import { expect, test } from "bun:test";
import { PERSISTENCE_MIGRATIONS, readCoreSchemaStateFromPool } from "./migrate";

test("schema probe reports incomplete migration state without writing", async () => {
	let queryCount = 0;
	const pool = {
		execute: async () => {
			queryCount += 1;
			return [[{ migration_id: "0001_core" }], []];
		},
	} as never;

	const state = await readCoreSchemaStateFromPool(pool);
	const latestMigration = PERSISTENCE_MIGRATIONS.at(-1);
	if (!latestMigration) throw new Error("Migration fixture is empty");

	expect(queryCount).toBe(1);
	expect(state).toEqual({
		status: "incomplete",
		expectedMigrationId: latestMigration.id,
		appliedMigrationIds: ["0001_core"],
		missingMigrationIds: PERSISTENCE_MIGRATIONS.slice(1).map(({ id }) => id),
	});
});

test("core migration contains the transaction-critical constraints", async () => {
	const sql = await Bun.file(
		new URL("../migrations/0001_core.sql", import.meta.url),
	).text();
	const prepaySql = await Bun.file(
		new URL("../migrations/0002_payment_prepay_attempts.sql", import.meta.url),
	).text();
	const notificationSql = await Bun.file(
		new URL(
			"../migrations/0003_wechat_payment_notifications.sql",
			import.meta.url,
		),
	).text();
	const queryScheduleSql = await Bun.file(
		new URL("../migrations/0004_payment_query_schedule.sql", import.meta.url),
	).text();
	const queryClaimSql = await Bun.file(
		new URL("../migrations/0005_payment_query_claims.sql", import.meta.url),
	).text();
	const patientMappingSql = await Bun.file(
		new URL("../migrations/0006_patient_provider_mapping.sql", import.meta.url),
	).text();
	const ownerScopeSql = await Bun.file(
		new URL(
			"../migrations/0007_owner_scoped_payment_foreign_keys.sql",
			import.meta.url,
		),
	).text();

	expect(sql).toContain("CREATE TABLE IF NOT EXISTS hp_payment_orders");
	expect(prepaySql).toContain(
		"CREATE TABLE IF NOT EXISTS hp_payment_prepay_attempts",
	);
	expect(prepaySql).toContain("uq_hp_prepay_owner_order_idempotency");
	expect(sql).toContain("uq_hp_orders_owner_idempotency");
	expect(sql).toContain("CREATE TABLE IF NOT EXISTS hp_outbox_events");
	expect(sql).toContain("claimed_until DATETIME(3) NULL");
	expect(notificationSql).toContain(
		"CREATE TABLE IF NOT EXISTS hp_wechat_payment_notifications",
	);
	expect(notificationSql).toContain("uq_hp_wechat_notification_transaction");
	expect(notificationSql).toContain("fk_hp_wechat_notification_order");
	expect(queryScheduleSql).toContain("ADD COLUMN query_attempts");
	expect(queryScheduleSql).toContain("ADD COLUMN next_query_at");
	expect(queryScheduleSql).toContain("ix_hp_prepay_query_due");
	expect(queryClaimSql).toContain("ADD COLUMN query_claimed_until");
	expect(queryClaimSql).toContain("ix_hp_prepay_query_claim");
	expect(patientMappingSql).toContain("provider_patient_id VARCHAR(128)");
	expect(patientMappingSql).toContain("uq_hp_patients_owner_provider_patient");
	expect(ownerScopeSql).toContain("uq_hp_patients_owner_patient");
	expect(ownerScopeSql).toContain("fk_hp_orders_owner_patient");
	expect(ownerScopeSql).toContain("fk_hp_quotes_owner_patient");
	expect(ownerScopeSql).toContain("fk_hp_prepay_owner_order");
});
