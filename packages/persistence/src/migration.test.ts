import { expect, test } from "bun:test";
import {
	PERSISTENCE_MIGRATIONS,
	PERSISTENCE_SCHEMA_COLUMNS,
	PERSISTENCE_SCHEMA_FOREIGN_KEYS,
	PERSISTENCE_SCHEMA_INDEXES,
	PERSISTENCE_SCHEMA_TABLES,
	assertMigrationTargetAllowed,
	readCoreSchemaStateFromPool,
} from "./migrate";

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
		schemaStatus: "not_checked",
		missingSchemaObjects: [],
	});
});

test("migration target safety allows local compose and rejects remote targets by default", () => {
	expect(() =>
		assertMigrationTargetAllowed(
			"mysql://hospital:secret@127.0.0.1:3307/hospital",
		),
	).not.toThrow();
	expect(() =>
		assertMigrationTargetAllowed(
			"mysql://hospital:secret@db.internal/hospital",
		),
	).toThrow("PERSISTENCE_MIGRATION_ALLOW_REMOTE=true");
	expect(() =>
		assertMigrationTargetAllowed(
			"mysql://hospital:secret@db.internal/hospital",
			{
				PERSISTENCE_MIGRATION_ALLOW_REMOTE: "true",
			},
		),
	).not.toThrow();
});

test("production migration requires a second explicit confirmation", () => {
	expect(() =>
		assertMigrationTargetAllowed(
			"mysql://hospital:secret@db.internal/hospital",
			{
				NODE_ENV: "production",
				PERSISTENCE_MIGRATION_ALLOW_REMOTE: "true",
			},
		),
	).toThrow("PERSISTENCE_MIGRATION_ALLOW_PRODUCTION=true");
	expect(() =>
		assertMigrationTargetAllowed(
			"mysql://hospital:secret@db.internal/hospital",
			{
				NODE_ENV: "production",
				PERSISTENCE_MIGRATION_ALLOW_REMOTE: "true",
				PERSISTENCE_MIGRATION_ALLOW_PRODUCTION: "true",
			},
		),
	).not.toThrow();
});

test("schema probe rejects complete migration history when required objects are missing", async () => {
	const calls: string[] = [];
	const pool = {
		execute: async (sql: string) => {
			calls.push(sql);
			if (sql.includes("SELECT migration_id FROM hp_schema_migrations")) {
				return [
					PERSISTENCE_MIGRATIONS.map(({ id }) => ({ migration_id: id })),
					[],
				];
			}
			if (sql.includes("INFORMATION_SCHEMA.TABLES")) {
				return [[{ table_name: PERSISTENCE_SCHEMA_TABLES[0] }], []];
			}
			return [[], []];
		},
	} as never;

	const state = await readCoreSchemaStateFromPool(pool);

	expect(calls).toHaveLength(5);
	expect(state.status).toBe("incomplete");
	expect(state.schemaStatus).toBe("incomplete");
	expect(state.missingMigrationIds).toEqual([]);
	expect(state.missingSchemaObjects).toContain("table:hp_patients");
	expect(state.missingSchemaObjects).toContain(
		"foreign-key:hp_payment_orders.fk_hp_orders_owner_patient",
	);
});

test("every migration declares the non-transactional DDL recovery policy", () => {
	expect(PERSISTENCE_MIGRATIONS.length).toBeGreaterThan(0);
	expect(
		PERSISTENCE_MIGRATIONS.every(
			(migration) => migration.executionMode === "non_transactional_ddl",
		),
	).toBe(true);
});

test("schema probe manifest stays synchronized with migration sources", async () => {
	const migrationSources = await Promise.all(
		PERSISTENCE_MIGRATIONS.map(({ file }) =>
			Bun.file(new URL(file, import.meta.url)).text(),
		),
	);
	const normalizedSql = migrationSources.join("\n").replace(/\s+/g, " ");

	// hp_schema_migration_runs is the runner's bootstrap control table, created
	// before migration 0001 so an interrupted DDL run can be recorded safely.
	for (const table of PERSISTENCE_SCHEMA_TABLES) {
		if (table === "hp_schema_migration_runs") continue;
		expect(normalizedSql).toContain(`CREATE TABLE IF NOT EXISTS ${table}`);
	}
	for (const { table, columns } of PERSISTENCE_SCHEMA_COLUMNS) {
		for (const column of columns) {
			if (table === "hp_schema_migration_runs") continue;
			expect(normalizedSql).toContain(column);
		}
	}
	for (const { name } of PERSISTENCE_SCHEMA_INDEXES) {
		expect(normalizedSql).toContain(name);
	}
	for (const {
		name,
		columns,
		referencedTable,
		referencedColumns,
	} of PERSISTENCE_SCHEMA_FOREIGN_KEYS) {
		expect(normalizedSql).toContain(`CONSTRAINT ${name}`);
		expect(normalizedSql).toContain(`FOREIGN KEY (${columns.join(", ")})`);
		expect(normalizedSql).toContain(
			`REFERENCES ${referencedTable} (${referencedColumns.join(", ")})`,
		);
	}
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
