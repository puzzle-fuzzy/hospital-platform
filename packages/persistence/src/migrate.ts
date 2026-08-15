import { createLogger } from "@hospital/observability";
import { createPool, type PoolConnection } from "mysql2/promise";

const MIGRATIONS = [
	{ id: "0001_core", file: "../migrations/0001_core.sql" },
	{
		id: "0002_payment_prepay_attempts",
		file: "../migrations/0002_payment_prepay_attempts.sql",
	},
	{
		id: "0003_wechat_payment_notifications",
		file: "../migrations/0003_wechat_payment_notifications.sql",
	},
] as const;

const logger = createLogger({
	service: "hospital-persistence-migrate",
	environment: Bun.env.NODE_ENV ?? "development",
	level: (Bun.env.LOG_LEVEL as "debug" | "info" | "warn" | "error") ?? "info",
});

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
	let transactionStarted = false;
	let currentMigrationId: string | undefined;
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
		let appliedAny = false;
		for (const migration of MIGRATIONS) {
			const [appliedRows] = await connection.execute(
				"SELECT migration_id FROM hp_schema_migrations WHERE migration_id = ? LIMIT 1",
				[migration.id],
			);
			if (Array.isArray(appliedRows) && appliedRows.length > 0) {
				logger.info(
					{
						event: "persistence.migration.skipped",
						migrationId: migration.id,
					},
					"Persistence migration is already applied",
				);
				continue;
			}

			const migrationSql = await Bun.file(
				new URL(migration.file, import.meta.url),
			).text();
			currentMigrationId = migration.id;
			logger.info(
				{ event: "persistence.migration.started", migrationId: migration.id },
				"Applying persistence migration",
			);
			await connection.beginTransaction();
			transactionStarted = true;
			await connection.query(migrationSql);
			await connection.execute(
				"INSERT INTO hp_schema_migrations (migration_id, applied_at) VALUES (?, ?)",
				[migration.id, new Date()],
			);
			await connection.commit();
			transactionStarted = false;
			currentMigrationId = undefined;
			appliedAny = true;
			logger.info(
				{ event: "persistence.migration.succeeded", migrationId: migration.id },
				"Persistence migration applied",
			);
		}

		const latestMigration = MIGRATIONS.at(-1);
		if (!latestMigration)
			throw new Error("No persistence migrations configured");
		return {
			migrationId: latestMigration.id,
			status: appliedAny ? ("applied" as const) : ("already_applied" as const),
		};
	} catch (error) {
		if (transactionStarted) await connection?.rollback().catch(() => undefined);
		logger.error(
			{
				event: "persistence.migration.failed",
				...(currentMigrationId ? { migrationId: currentMigrationId } : {}),
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
