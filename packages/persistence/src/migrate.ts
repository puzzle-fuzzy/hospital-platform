import { createLogger } from "@hospital/observability";
import {
	createPool,
	type Pool,
	type PoolConnection,
	type RowDataPacket,
} from "mysql2/promise";

/**
 * MySQL migration files currently contain DDL. MySQL DDL can implicitly
 * commit, so these migrations must never pretend to be transactionally
 * rollbackable. The runner records a durable execution marker before DDL and
 * requires manual inspection after an interrupted or failed run.
 */
export type PersistenceMigration = {
	readonly id: string;
	readonly file: string;
	readonly executionMode: "non_transactional_ddl";
};

export const PERSISTENCE_MIGRATIONS = [
	{
		id: "0001_core",
		file: "../migrations/0001_core.sql",
		executionMode: "non_transactional_ddl",
	},
	{
		id: "0002_payment_prepay_attempts",
		file: "../migrations/0002_payment_prepay_attempts.sql",
		executionMode: "non_transactional_ddl",
	},
	{
		id: "0003_wechat_payment_notifications",
		file: "../migrations/0003_wechat_payment_notifications.sql",
		executionMode: "non_transactional_ddl",
	},
	{
		id: "0004_payment_query_schedule",
		file: "../migrations/0004_payment_query_schedule.sql",
		executionMode: "non_transactional_ddl",
	},
	{
		id: "0005_payment_query_claims",
		file: "../migrations/0005_payment_query_claims.sql",
		executionMode: "non_transactional_ddl",
	},
	{
		id: "0006_patient_provider_mapping",
		file: "../migrations/0006_patient_provider_mapping.sql",
		executionMode: "non_transactional_ddl",
	},
	{
		id: "0007_owner_scoped_payment_foreign_keys",
		file: "../migrations/0007_owner_scoped_payment_foreign_keys.sql",
		executionMode: "non_transactional_ddl",
	},
] as const satisfies readonly PersistenceMigration[];

type MigrationRunStatus = "started" | "failed" | "succeeded";

/**
 * Separate control table for migration execution state. It is intentionally
 * not the schema gate: a `started`/`failed` row means the next run must stop
 * for manual inspection instead of blindly replaying potentially partial DDL.
 */
const MIGRATION_RUNS_TABLE_SQL = `
	CREATE TABLE IF NOT EXISTS hp_schema_migration_runs (
		migration_id VARCHAR(128) NOT NULL,
		execution_mode VARCHAR(32) NOT NULL,
		status VARCHAR(16) NOT NULL,
		started_at DATETIME(3) NOT NULL,
		completed_at DATETIME(3) NULL,
		error_message VARCHAR(1024) NULL,
		PRIMARY KEY (migration_id)
	) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_unicode_ci
`;

export type CoreSchemaState = {
	status: "ready" | "incomplete";
	expectedMigrationId: string;
	appliedMigrationIds: string[];
	missingMigrationIds: string[];
};

const logger = createLogger({
	service: "hospital-persistence-migrate",
	environment: Bun.env.NODE_ENV ?? "development",
	level: (Bun.env.LOG_LEVEL as "debug" | "info" | "warn" | "error") ?? "info",
});

/**
 * 只读检查目标库是否已经包含仓库声明的全部 migration。
 *
 * 它不执行迁移、不写入数据库，也不把 schema gate 自动改成 true；
 * 发布 preflight 可以据此区分“连接可用”和“目标 schema 已验收”。
 */
export async function readCoreSchemaState(
	databaseUrl = Bun.env.DATABASE_URL,
): Promise<CoreSchemaState> {
	if (!databaseUrl) {
		throw new Error("DATABASE_URL is required to inspect persistence schema");
	}

	const pool = createPool({
		uri: databaseUrl,
		connectionLimit: 1,
		connectTimeout: 3_000,
		dateStrings: true,
		waitForConnections: true,
	});
	try {
		return readCoreSchemaStateFromPool(pool);
	} finally {
		await pool.end();
	}
}

/**
 * 使用已有连接池只读检查 migration，避免每次 readiness 请求新建连接池。
 * migration 表不存在或查询失败时由调用方映射为 unavailable，绝不自动建表。
 */
export async function readCoreSchemaStateFromPool(
	pool: Pick<Pool, "execute">,
): Promise<CoreSchemaState> {
	const placeholders = PERSISTENCE_MIGRATIONS.map(() => "?").join(", ");
	const [rows] = await pool.execute<
		(RowDataPacket & { migration_id: string })[]
	>(
		"SELECT migration_id FROM hp_schema_migrations WHERE migration_id IN (" +
			placeholders +
			")",
		PERSISTENCE_MIGRATIONS.map(({ id }) => id),
	);
	const applied = new Set(rows.map((row) => row.migration_id));
	const expectedMigrationIds = PERSISTENCE_MIGRATIONS.map(({ id }) => id);
	const missingMigrationIds = expectedMigrationIds.filter(
		(id) => !applied.has(id),
	);
	return {
		status: missingMigrationIds.length === 0 ? "ready" : "incomplete",
		expectedMigrationId:
			expectedMigrationIds.at(-1) ?? "no-migrations-configured",
		appliedMigrationIds: expectedMigrationIds.filter((id) => applied.has(id)),
		missingMigrationIds,
	};
}

/**
 * 显式执行目标库 migration；API 启动时不会隐式改表。
 *
 * 迁移命令只接受 DATABASE_URL，不打印连接串，也不会替应用打开
 * PERSISTENCE_SCHEMA_READY。schema gate 必须由部署流程在真实验收后设置。
 */
export async function runCoreMigration(databaseUrl = Bun.env.DATABASE_URL) {
	if (!databaseUrl) {
		throw new Error("DATABASE_URL is required to run persistence migrations");
	}

	const pool = createPool({
		uri: databaseUrl,
		connectionLimit: 1,
		connectTimeout: 3_000,
		dateStrings: true,
		multipleStatements: true,
		waitForConnections: true,
	});

	let connection: PoolConnection | undefined;
	let currentMigrationId: string | undefined;
	let currentMigrationExecutionMode:
		| PersistenceMigration["executionMode"]
		| undefined;
	let migrationRunStarted = false;
	try {
		connection = await pool.getConnection();
		// 首次运行时 migration history 表本身还不存在，因此先建立这个
		// 极小的控制表，再决定是否需要执行目标 migration。
		await connection.query(`
			CREATE TABLE IF NOT EXISTS hp_schema_migrations (
				migration_id VARCHAR(128) NOT NULL,
				applied_at DATETIME(3) NOT NULL,
				PRIMARY KEY (migration_id)
			) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_unicode_ci
		`);
		// DDL is not transactionally rollbackable in MySQL. Persisting this marker
		// before each migration gives operators durable evidence after a crash.
		await connection.query(MIGRATION_RUNS_TABLE_SQL);
		let appliedAny = false;
		for (const migration of PERSISTENCE_MIGRATIONS) {
			currentMigrationId = migration.id;
			currentMigrationExecutionMode = migration.executionMode;
			migrationRunStarted = false;
			const [appliedRows] = await connection.execute(
				"SELECT migration_id FROM hp_schema_migrations WHERE migration_id = ? LIMIT 1",
				[migration.id],
			);
			if (Array.isArray(appliedRows) && appliedRows.length > 0) {
				// If the process died after recording schema history but before
				// recording success, history is authoritative and can be reconciled.
				await connection.execute(
					"UPDATE hp_schema_migration_runs SET status = 'succeeded', completed_at = COALESCE(completed_at, ?), error_message = NULL WHERE migration_id = ? AND status <> 'succeeded'",
					[new Date(), migration.id],
				);
				logger.info(
					{
						event: "persistence.migration.skipped",
						migrationId: migration.id,
						reconciledRun: true,
					},
					"Persistence migration is already applied",
				);
				continue;
			}

			const [runRows] = await connection.execute<
				(RowDataPacket & { status: MigrationRunStatus })[]
			>(
				"SELECT status FROM hp_schema_migration_runs WHERE migration_id = ? LIMIT 1",
				[migration.id],
			);
			const previousRun = Array.isArray(runRows) ? runRows[0] : undefined;
			if (previousRun) {
				throw new Error(
					`Migration ${migration.id} has a previous ${previousRun.status} run; inspect the target schema before retrying`,
				);
			}

			const migrationSql = await Bun.file(
				new URL(migration.file, import.meta.url),
			).text();
			logger.info(
				{
					event: "persistence.migration.started",
					migrationId: migration.id,
					executionMode: migration.executionMode,
					recovery: "manual_inspection_if_failed",
				},
				"Applying persistence migration",
			);
			await connection.execute(
				"INSERT INTO hp_schema_migration_runs (migration_id, execution_mode, status, started_at) VALUES (?, ?, 'started', ?)",
				[migration.id, migration.executionMode, new Date()],
			);
			migrationRunStarted = true;
			// Do not wrap this in beginTransaction/rollback. MySQL DDL can commit
			// implicitly, so an apparent rollback would provide false safety.
			await connection.query(migrationSql);
			await connection.execute(
				"INSERT INTO hp_schema_migrations (migration_id, applied_at) VALUES (?, ?)",
				[migration.id, new Date()],
			);
			await connection.execute(
				"UPDATE hp_schema_migration_runs SET status = 'succeeded', completed_at = ?, error_message = NULL WHERE migration_id = ?",
				[new Date(), migration.id],
			);
			migrationRunStarted = false;
			currentMigrationId = undefined;
			currentMigrationExecutionMode = undefined;
			appliedAny = true;
			logger.info(
				{ event: "persistence.migration.succeeded", migrationId: migration.id },
				"Persistence migration applied",
			);
		}

		const latestMigration = PERSISTENCE_MIGRATIONS.at(-1);
		if (!latestMigration)
			throw new Error("No persistence migrations configured");
		return {
			migrationId: latestMigration.id,
			status: appliedAny ? ("applied" as const) : ("already_applied" as const),
		};
	} catch (error) {
		let failureRecorded = false;
		if (connection && currentMigrationId && migrationRunStarted) {
			failureRecorded = await connection
				.execute(
					"UPDATE hp_schema_migration_runs SET status = 'failed', completed_at = ?, error_message = ? WHERE migration_id = ? AND status = 'started'",
					[
						new Date(),
						error instanceof Error
							? error.message.slice(0, 1024)
							: "unknown error",
						currentMigrationId,
					],
				)
				.then(() => true)
				.catch(() => false);
		}
		logger.error(
			{
				event: "persistence.migration.failed",
				...(currentMigrationId ? { migrationId: currentMigrationId } : {}),
				...(currentMigrationExecutionMode
					? { executionMode: currentMigrationExecutionMode }
					: {}),
				...(migrationRunStarted
					? {
							manualRecoveryRequired: true,
							failureRecorded,
						}
					: {}),
				err: error,
			},
			"Persistence migration failed",
		);
		throw error;
	} finally {
		connection?.release();
		await pool.end();
	}
}

if (import.meta.main) {
	await runCoreMigration().catch(() => {
		process.exitCode = 1;
	});
}
