import { createLogger } from "@hospital/observability";
import {
	createPool,
	type Pool,
	type PoolConnection,
	type RowDataPacket,
} from "mysql2/promise";

/**
 * 当前 MySQL 迁移文件包含 DDL。MySQL DDL 可能隐式提交，因此迁移执行器不能
 * 把它伪装成可以通过事务回滚的操作。执行器会在 DDL 前记录持久化执行标记；
 * 如果进程中断或执行失败，必须由运维人工检查后再决定如何继续。
 */
export type PersistenceMigration = {
	readonly id: string;
	readonly file: string;
	readonly executionMode: "non_transactional_ddl";
};

/**
 * 平台认可的迁移顺序与文件清单。
 *
 * 迁移执行器只能按这里的不可变顺序推进，不能通过读取目录名或“最新文件”
 * 猜测目标版本。每一项都是非事务 DDL：MySQL 可能隐式提交，所以执行失败
 * 后必须先核对数据库事实和迁移运行记录，再决定是否继续，不能盲目重放。
 */
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
	{
		id: "0008_appointment_schedule_snapshots",
		file: "../migrations/0008_appointment_schedule_snapshots.sql",
		executionMode: "non_transactional_ddl",
	},
	{
		id: "0009_report_references",
		file: "../migrations/0009_report_references.sql",
		executionMode: "non_transactional_ddl",
	},
	{
		id: "0010_health_knowledge",
		file: "../migrations/0010_health_knowledge.sql",
		executionMode: "non_transactional_ddl",
	},
	{
		id: "0011_health_knowledge_versioned_keys",
		file: "../migrations/0011_health_knowledge_versioned_keys.sql",
		executionMode: "non_transactional_ddl",
	},
	{
		id: "0012_patient_provider_references",
		file: "../migrations/0012_patient_provider_references.sql",
		executionMode: "non_transactional_ddl",
	},
	{
		id: "0013_patient_directory_snapshot",
		file: "../migrations/0013_patient_directory_snapshot.sql",
		executionMode: "non_transactional_ddl",
	},
	{
		id: "0014_user_profiles",
		file: "../migrations/0014_user_profiles.sql",
		executionMode: "non_transactional_ddl",
	},
	{
		id: "0015_patient_directory_sync_operations",
		file: "../migrations/0015_patient_directory_sync_operations.sql",
		executionMode: "non_transactional_ddl",
	},
	{
		id: "0016_patient_directory_sync_owner_index",
		file: "../migrations/0016_patient_directory_sync_owner_index.sql",
		executionMode: "non_transactional_ddl",
	},
] as const satisfies readonly PersistenceMigration[];

/**
 * 当前 repository 边界必须存在的 schema 对象。迁移历史本身不能证明这些对象
 * 仍然存在，因此 readiness 除了检查 `hp_schema_migrations`，还会读取 MySQL
 * 数据字典进行结构探针。
 */
export const PERSISTENCE_SCHEMA_TABLES = [
	"hp_schema_migrations",
	"hp_schema_migration_runs",
	"hp_identity_users",
	"hp_user_profiles",
	"hp_patients",
	"hp_patient_directory_sync_operations",
	"hp_patient_provider_references",
	"hp_payment_quotes",
	"hp_payment_orders",
	"hp_outbox_events",
	"hp_payment_prepay_attempts",
	"hp_wechat_payment_notifications",
	"hp_appointment_schedule_snapshots",
	"hp_report_references",
	"hp_health_knowledge_publications",
	"hp_health_knowledge_items",
	"hp_health_knowledge_disease_details",
	"hp_health_knowledge_drug_details",
	"hp_health_knowledge_disease_relations",
	"hp_health_knowledge_part_symptoms",
	"hp_health_knowledge_symptom_diseases",
	"hp_health_knowledge_disease_drugs",
] as const;

export const PERSISTENCE_SCHEMA_COLUMNS = [
	{ table: "hp_schema_migrations", columns: ["migration_id", "applied_at"] },
	{
		table: "hp_schema_migration_runs",
		columns: ["migration_id", "execution_mode", "status", "started_at"],
	},
	{
		table: "hp_identity_users",
		columns: ["user_id", "provider_subject"],
	},
	{
		table: "hp_user_profiles",
		columns: [
			"user_id",
			"display_name",
			"gender",
			"age",
			"email",
			"version",
			"created_at",
			"updated_at",
		],
	},
	{
		table: "hp_patients",
		columns: [
			"patient_id",
			"owner_user_id",
			"display_name",
			"relationship",
			"card_number_masked",
			"source",
			"provider_name",
			"provider_patient_id",
			"directory_active",
			"directory_last_seen_at",
		],
	},
	{
		table: "hp_patient_directory_sync_operations",
		columns: [
			"operation_id",
			"owner_user_id",
			"provider_name",
			"idempotency_key",
			"status",
			"attempt_count",
			"observed_at",
			"lease_until",
			"completed_at",
			"result_digest",
			"created_at",
			"updated_at",
		],
	},
	{
		table: "hp_patient_provider_references",
		columns: [
			"owner_user_id",
			"patient_id",
			"provider_name",
			"reference_kind",
			"provider_patient_id",
			"created_at",
			"updated_at",
		],
	},
	{
		table: "hp_payment_quotes",
		columns: [
			"quote_id",
			"owner_user_id",
			"patient_id",
			"total_fen",
			"insurance_fen",
			"cash_fen",
			"expires_at",
		],
	},
	{
		table: "hp_payment_orders",
		columns: [
			"order_id",
			"owner_user_id",
			"patient_id",
			"idempotency_key",
			"total_fen",
			"insurance_fen",
			"cash_fen",
			"state",
			"version",
		],
	},
	{
		table: "hp_outbox_events",
		columns: [
			"event_id",
			"event_name",
			"aggregate_id",
			"payload",
			"available_at",
			"claimed_until",
			"processed_at",
		],
	},
	{
		table: "hp_payment_prepay_attempts",
		columns: [
			"attempt_id",
			"owner_user_id",
			"order_id",
			"idempotency_key",
			"status",
			"version",
			"prepay_id_hash",
			"pay_params_ciphertext",
			"query_attempts",
			"last_queried_at",
			"next_query_at",
			"query_claimed_until",
		],
	},
	{
		table: "hp_wechat_payment_notifications",
		columns: [
			"notification_id",
			"order_id",
			"total_fen",
			"provider_transaction_id",
		],
	},
	{
		table: "hp_appointment_schedule_snapshots",
		columns: [
			"schedule_id",
			"provider",
			"provider_schedule_id",
			"department_id",
			"doctor_id",
			"work_date",
			"total_slots",
			"available_slots",
			"provider_request_id",
			"observed_at",
			"expires_at",
		],
	},
	{
		table: "hp_report_references",
		columns: [
			"report_id",
			"owner_user_id",
			"patient_id",
			"provider",
			"kind",
			"provider_report_id",
			"expires_at",
			"created_at",
			"updated_at",
		],
	},
	{
		table: "hp_health_knowledge_publications",
		columns: [
			"content_version",
			"status",
			"source_label",
			"reviewed_at",
			"disclaimer",
			"effective_from",
			"effective_to",
		],
	},
	{
		table: "hp_health_knowledge_items",
		columns: [
			"item_id",
			"content_version",
			"item_kind",
			"name",
			"initial_letter",
		],
	},
	{
		table: "hp_health_knowledge_disease_details",
		columns: [
			"disease_id",
			"content_version",
			"disease_alias",
			"treatment_department",
			"cause",
			"symptoms",
			"treatment",
		],
	},
	{
		table: "hp_health_knowledge_drug_details",
		columns: [
			"drug_id",
			"content_version",
			"manufacturer",
			"indications",
			"usage_dosage",
			"precautions",
		],
	},
	{
		table: "hp_health_knowledge_disease_relations",
		columns: ["content_version", "relation_kind", "relation_id", "disease_id"],
	},
	{
		table: "hp_health_knowledge_part_symptoms",
		columns: ["content_version", "part_id", "symptom_id"],
	},
	{
		table: "hp_health_knowledge_symptom_diseases",
		columns: ["content_version", "symptom_id", "disease_id"],
	},
	{
		table: "hp_health_knowledge_disease_drugs",
		columns: [
			"content_version",
			"disease_id",
			"drug_id",
			"drug_name",
			"is_clickable",
		],
	},
] as const;

/** 保护 owner 隔离查询和租约竞争的安全关键索引及其列顺序。 */
export const PERSISTENCE_SCHEMA_INDEXES = [
	{
		table: "hp_patients",
		name: "uq_hp_patients_owner_patient",
		columns: ["owner_user_id", "patient_id"],
	},
	{
		table: "hp_patient_provider_references",
		name: "uq_hp_patient_provider_refs_owner_provider_reference",
		columns: [
			"owner_user_id",
			"provider_name",
			"reference_kind",
			"provider_patient_id",
		],
	},
	{
		table: "hp_patients",
		name: "uq_hp_patients_owner_provider_patient",
		columns: ["owner_user_id", "provider_name", "provider_patient_id"],
	},
	{
		table: "hp_patients",
		name: "ix_hp_patients_owner_directory_status",
		columns: [
			"owner_user_id",
			"provider_name",
			"directory_active",
			"directory_last_seen_at",
		],
	},
	{
		table: "hp_patient_directory_sync_operations",
		name: "uq_hp_patient_sync_owner_provider_key",
		columns: ["owner_user_id", "provider_name", "idempotency_key"],
	},
	{
		table: "hp_patient_directory_sync_operations",
		name: "ix_hp_patient_sync_status_lease",
		columns: ["status", "lease_until"],
	},
	{
		table: "hp_patient_directory_sync_operations",
		name: "ix_hp_patient_sync_owner_provider_state",
		columns: ["owner_user_id", "provider_name", "status", "lease_until"],
	},
	{
		table: "hp_payment_orders",
		name: "uq_hp_orders_owner_order",
		columns: ["owner_user_id", "order_id"],
	},
	{
		table: "hp_payment_prepay_attempts",
		name: "uq_hp_prepay_owner_order_idempotency",
		columns: ["owner_user_id", "order_id", "idempotency_key"],
	},
	{
		table: "hp_payment_prepay_attempts",
		name: "ix_hp_prepay_query_due",
		columns: ["status", "next_query_at"],
	},
	{
		table: "hp_payment_prepay_attempts",
		name: "ix_hp_prepay_query_claim",
		columns: ["status", "next_query_at", "query_claimed_until"],
	},
	{
		table: "hp_wechat_payment_notifications",
		name: "uq_hp_wechat_notification_transaction",
		columns: ["provider_transaction_id"],
	},
	{
		table: "hp_appointment_schedule_snapshots",
		name: "ix_hp_appointment_snapshots_expiry",
		columns: ["provider", "expires_at"],
	},
	{
		table: "hp_appointment_schedule_snapshots",
		name: "ix_hp_appointment_snapshots_provider_schedule",
		columns: ["provider", "provider_schedule_id"],
	},
	{
		table: "hp_report_references",
		name: "uq_hp_report_references_provider",
		columns: [
			"owner_user_id",
			"patient_id",
			"provider",
			"kind",
			"provider_report_id",
		],
	},
	{
		table: "hp_report_references",
		name: "ix_hp_report_references_owner_expiry",
		columns: ["owner_user_id", "expires_at"],
	},
	{
		table: "hp_health_knowledge_publications",
		name: "ix_hp_health_knowledge_publications_published",
		columns: ["status", "effective_from", "effective_to", "reviewed_at"],
	},
	{
		table: "hp_health_knowledge_items",
		name: "ix_hp_health_knowledge_items_catalog",
		columns: ["content_version", "item_kind", "initial_letter", "name"],
	},
	{
		table: "hp_health_knowledge_items",
		name: "PRIMARY",
		columns: ["content_version", "item_id"],
	},
	{
		table: "hp_health_knowledge_disease_details",
		name: "PRIMARY",
		columns: ["content_version", "disease_id"],
	},
	{
		table: "hp_health_knowledge_drug_details",
		name: "PRIMARY",
		columns: ["content_version", "drug_id"],
	},
	{
		table: "hp_health_knowledge_disease_relations",
		name: "ix_hp_health_knowledge_disease_relations_relation",
		columns: ["content_version", "relation_kind", "relation_id"],
	},
	{
		table: "hp_health_knowledge_part_symptoms",
		name: "ix_hp_health_knowledge_part_symptoms_part",
		columns: ["content_version", "part_id"],
	},
	{
		table: "hp_health_knowledge_symptom_diseases",
		name: "ix_hp_health_knowledge_symptom_diseases_symptom",
		columns: ["content_version", "symptom_id"],
	},
	{
		table: "hp_health_knowledge_disease_drugs",
		name: "ix_hp_health_knowledge_disease_drugs_disease",
		columns: ["content_version", "disease_id"],
	},
] as const;

/** 复合外键防止患者或订单跨越 owner，关联到另一位用户的数据。 */
export const PERSISTENCE_SCHEMA_FOREIGN_KEYS = [
	{
		table: "hp_user_profiles",
		name: "fk_hp_user_profiles_user",
		columns: ["user_id"],
		referencedTable: "hp_identity_users",
		referencedColumns: ["user_id"],
	},
	{
		table: "hp_patient_directory_sync_operations",
		name: "fk_hp_patient_sync_owner",
		columns: ["owner_user_id"],
		referencedTable: "hp_identity_users",
		referencedColumns: ["user_id"],
	},
	{
		table: "hp_payment_orders",
		name: "fk_hp_orders_owner_patient",
		columns: ["owner_user_id", "patient_id"],
		referencedTable: "hp_patients",
		referencedColumns: ["owner_user_id", "patient_id"],
	},
	{
		table: "hp_payment_quotes",
		name: "fk_hp_quotes_owner_patient",
		columns: ["owner_user_id", "patient_id"],
		referencedTable: "hp_patients",
		referencedColumns: ["owner_user_id", "patient_id"],
	},
	{
		table: "hp_payment_prepay_attempts",
		name: "fk_hp_prepay_owner_order",
		columns: ["owner_user_id", "order_id"],
		referencedTable: "hp_payment_orders",
		referencedColumns: ["owner_user_id", "order_id"],
	},
	{
		table: "hp_report_references",
		name: "fk_hp_report_references_owner_patient",
		columns: ["owner_user_id", "patient_id"],
		referencedTable: "hp_patients",
		referencedColumns: ["owner_user_id", "patient_id"],
	},
	{
		table: "hp_patient_provider_references",
		name: "fk_hp_patient_provider_refs_owner_patient",
		columns: ["owner_user_id", "patient_id"],
		referencedTable: "hp_patients",
		referencedColumns: ["owner_user_id", "patient_id"],
	},
	{
		table: "hp_health_knowledge_items",
		name: "fk_hp_health_knowledge_items_publication",
		columns: ["content_version"],
		referencedTable: "hp_health_knowledge_publications",
		referencedColumns: ["content_version"],
	},
	{
		table: "hp_health_knowledge_disease_details",
		name: "fk_hp_health_knowledge_disease_item_version",
		columns: ["content_version", "disease_id"],
		referencedTable: "hp_health_knowledge_items",
		referencedColumns: ["content_version", "item_id"],
	},
	{
		table: "hp_health_knowledge_disease_details",
		name: "fk_hp_health_knowledge_disease_publication",
		columns: ["content_version"],
		referencedTable: "hp_health_knowledge_publications",
		referencedColumns: ["content_version"],
	},
	{
		table: "hp_health_knowledge_drug_details",
		name: "fk_hp_health_knowledge_drug_item_version",
		columns: ["content_version", "drug_id"],
		referencedTable: "hp_health_knowledge_items",
		referencedColumns: ["content_version", "item_id"],
	},
	{
		table: "hp_health_knowledge_drug_details",
		name: "fk_hp_health_knowledge_drug_publication",
		columns: ["content_version"],
		referencedTable: "hp_health_knowledge_publications",
		referencedColumns: ["content_version"],
	},
	{
		table: "hp_health_knowledge_disease_relations",
		name: "fk_hp_health_knowledge_disease_relations_publication",
		columns: ["content_version"],
		referencedTable: "hp_health_knowledge_publications",
		referencedColumns: ["content_version"],
	},
	{
		table: "hp_health_knowledge_disease_relations",
		name: "fk_hp_health_knowledge_disease_relations_relation_version",
		columns: ["content_version", "relation_id"],
		referencedTable: "hp_health_knowledge_items",
		referencedColumns: ["content_version", "item_id"],
	},
	{
		table: "hp_health_knowledge_disease_relations",
		name: "fk_hp_health_knowledge_disease_relations_disease_version",
		columns: ["content_version", "disease_id"],
		referencedTable: "hp_health_knowledge_items",
		referencedColumns: ["content_version", "item_id"],
	},
	{
		table: "hp_health_knowledge_part_symptoms",
		name: "fk_hp_health_knowledge_part_symptoms_publication",
		columns: ["content_version"],
		referencedTable: "hp_health_knowledge_publications",
		referencedColumns: ["content_version"],
	},
	{
		table: "hp_health_knowledge_part_symptoms",
		name: "fk_hp_health_knowledge_part_symptoms_part_version",
		columns: ["content_version", "part_id"],
		referencedTable: "hp_health_knowledge_items",
		referencedColumns: ["content_version", "item_id"],
	},
	{
		table: "hp_health_knowledge_part_symptoms",
		name: "fk_hp_health_knowledge_part_symptoms_symptom_version",
		columns: ["content_version", "symptom_id"],
		referencedTable: "hp_health_knowledge_items",
		referencedColumns: ["content_version", "item_id"],
	},
	{
		table: "hp_health_knowledge_symptom_diseases",
		name: "fk_hp_health_knowledge_symptom_diseases_publication",
		columns: ["content_version"],
		referencedTable: "hp_health_knowledge_publications",
		referencedColumns: ["content_version"],
	},
	{
		table: "hp_health_knowledge_symptom_diseases",
		name: "fk_hp_health_knowledge_symptom_diseases_symptom_version",
		columns: ["content_version", "symptom_id"],
		referencedTable: "hp_health_knowledge_items",
		referencedColumns: ["content_version", "item_id"],
	},
	{
		table: "hp_health_knowledge_symptom_diseases",
		name: "fk_hp_health_knowledge_symptom_diseases_disease_version",
		columns: ["content_version", "disease_id"],
		referencedTable: "hp_health_knowledge_items",
		referencedColumns: ["content_version", "item_id"],
	},
	{
		table: "hp_health_knowledge_disease_drugs",
		name: "fk_hp_health_knowledge_disease_drugs_publication",
		columns: ["content_version"],
		referencedTable: "hp_health_knowledge_publications",
		referencedColumns: ["content_version"],
	},
	{
		table: "hp_health_knowledge_disease_drugs",
		name: "fk_hp_health_knowledge_disease_drugs_disease_version",
		columns: ["content_version", "disease_id"],
		referencedTable: "hp_health_knowledge_items",
		referencedColumns: ["content_version", "item_id"],
	},
	{
		table: "hp_health_knowledge_disease_drugs",
		name: "fk_hp_health_knowledge_disease_drugs_drug_version",
		columns: ["content_version", "drug_id"],
		referencedTable: "hp_health_knowledge_items",
		referencedColumns: ["content_version", "item_id"],
	},
] as const;

type MigrationRunStatus = "started" | "failed" | "succeeded";

/**
 * 独立记录迁移执行状态的控制表。它不会直接充当 schema gate：如果存在
 * `started`/`failed` 记录，下一次执行必须先停止并等待人工检查，不能盲目重放
 * 可能只执行了一半的 DDL。
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
	/** 迁移记录未齐全时不会执行结构查询，避免把半成品误判为完整。 */
	schemaStatus: "verified" | "incomplete" | "not_checked";
	missingSchemaObjects: string[];
};

const logger = createLogger({
	service: "hospital-persistence-migrate",
	environment: Bun.env.NODE_ENV ?? "development",
	level: (Bun.env.LOG_LEVEL as "debug" | "info" | "warn" | "error") ?? "info",
});

type MigrationEnvironment = {
	NODE_ENV?: string;
	PERSISTENCE_MIGRATION_ALLOW_REMOTE?: string;
	PERSISTENCE_MIGRATION_ALLOW_PRODUCTION?: string;
};

function isLocalDatabaseHost(hostname: string): boolean {
	const normalized = hostname.replace(/^\[|\]$/g, "");
	return (
		normalized === "localhost" ||
		normalized === "127.0.0.1" ||
		normalized === "::1"
	);
}

/**
 * 防止显式迁移命令误指向远程或生产数据库。本地 Compose 保持低摩擦；远程和
 * 生产目标必须通过独立且可见的部署意图确认，不能因为 URL 拼写错误而静默执行。
 */
export function assertMigrationTargetAllowed(
	databaseUrl: string,
	environment: MigrationEnvironment = Bun.env,
): void {
	let hostname: string;
	try {
		hostname = new URL(databaseUrl).hostname;
	} catch {
		throw new Error("DATABASE_URL must be a valid MySQL connection URL");
	}

	const allowRemote = environment.PERSISTENCE_MIGRATION_ALLOW_REMOTE === "true";
	const allowProduction =
		environment.PERSISTENCE_MIGRATION_ALLOW_PRODUCTION === "true";
	if (!isLocalDatabaseHost(hostname) && !allowRemote) {
		throw new Error(
			"Remote persistence migration requires PERSISTENCE_MIGRATION_ALLOW_REMOTE=true",
		);
	}
	if (environment.NODE_ENV === "production" && !allowProduction) {
		throw new Error(
			"Production persistence migration requires PERSISTENCE_MIGRATION_ALLOW_PRODUCTION=true",
		);
	}
}

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
	return readCoreSchemaStateAndClose(pool);
}

/**
 * 在关闭连接池前等待完整 schema probe。
 *
 * 这个顺序很重要：如果直接在 try/finally 中 return 未 await 的 Promise，
 * finally 会先关闭 pool，真实环境会把只读 probe 变成 `Pool is closed`。
 */
export async function readCoreSchemaStateAndClose(
	pool: Pick<Pool, "execute" | "end">,
): Promise<CoreSchemaState> {
	try {
		return await readCoreSchemaStateFromPool(pool);
	} finally {
		await pool.end();
	}
}

type SchemaTableRow = RowDataPacket & { table_name: string };
type SchemaColumnRow = RowDataPacket & {
	table_name: string;
	column_name: string;
};
type SchemaIndexRow = RowDataPacket & {
	table_name: string;
	index_name: string;
	sequence_in_index: number;
	column_name: string;
};
type SchemaForeignKeyRow = RowDataPacket & {
	table_name: string;
	constraint_name: string;
	ordinal_position: number;
	column_name: string;
	referenced_table_name: string | null;
	referenced_column_name: string | null;
};

function placeholders(count: number): string {
	return Array.from({ length: count }, () => "?").join(", ");
}

/**
 * 验证保护 repository 正确性的静态 schema 对象。`INFORMATION_SCHEMA` 查询是
 * 只读的，本探针不会修复或修改目标数据库；返回的对象名称是安全诊断信息，
 * 不是原始 SQL。
 */
async function readMissingSchemaObjects(
	pool: Pick<Pool, "execute">,
): Promise<string[]> {
	const missing: string[] = [];
	const [tableRows] = await pool.execute<SchemaTableRow[]>(
		`SELECT TABLE_NAME AS table_name
		 FROM INFORMATION_SCHEMA.TABLES
		 WHERE TABLE_SCHEMA = DATABASE()
		   AND TABLE_TYPE = 'BASE TABLE'
		   AND TABLE_NAME IN (${placeholders(PERSISTENCE_SCHEMA_TABLES.length)})`,
		[...PERSISTENCE_SCHEMA_TABLES],
	);
	const existingTables = new Set(tableRows.map((row) => row.table_name));
	for (const table of PERSISTENCE_SCHEMA_TABLES) {
		if (!existingTables.has(table)) missing.push(`table:${table}`);
	}

	const expectedColumns = PERSISTENCE_SCHEMA_COLUMNS.flatMap(
		({ table, columns }) => columns.map((column) => ({ table, column })),
	);
	const [columnRows] = await pool.execute<SchemaColumnRow[]>(
		`SELECT TABLE_NAME AS table_name, COLUMN_NAME AS column_name
		 FROM INFORMATION_SCHEMA.COLUMNS
		 WHERE TABLE_SCHEMA = DATABASE()
		   AND TABLE_NAME IN (${placeholders(PERSISTENCE_SCHEMA_TABLES.length)})`,
		[...PERSISTENCE_SCHEMA_TABLES],
	);
	const existingColumns = new Set(
		columnRows.map((row) => `${row.table_name}.${row.column_name}`),
	);
	for (const { table, column } of expectedColumns) {
		if (!existingColumns.has(`${table}.${column}`)) {
			missing.push(`column:${table}.${column}`);
		}
	}

	const [indexRows] = await pool.execute<SchemaIndexRow[]>(
		`SELECT TABLE_NAME AS table_name,
				INDEX_NAME AS index_name,
				SEQ_IN_INDEX AS sequence_in_index,
				COLUMN_NAME AS column_name
		 FROM INFORMATION_SCHEMA.STATISTICS
		 WHERE TABLE_SCHEMA = DATABASE()
		   AND TABLE_NAME IN (${placeholders(PERSISTENCE_SCHEMA_TABLES.length)})`,
		[...PERSISTENCE_SCHEMA_TABLES],
	);
	const existingIndexColumns = new Map<string, string[]>();
	for (const row of indexRows) {
		const key = `${row.table_name}.${row.index_name}`;
		const columns = existingIndexColumns.get(key) ?? [];
		columns[row.sequence_in_index - 1] = row.column_name;
		existingIndexColumns.set(key, columns);
	}
	for (const { table, name, columns } of PERSISTENCE_SCHEMA_INDEXES) {
		const key = `${table}.${name}`;
		if (
			JSON.stringify(existingIndexColumns.get(key) ?? []) !==
			JSON.stringify(columns)
		) {
			missing.push(`index:${key}`);
		}
	}

	const [foreignKeyRows] = await pool.execute<SchemaForeignKeyRow[]>(
		`SELECT TABLE_NAME AS table_name,
				CONSTRAINT_NAME AS constraint_name,
				ORDINAL_POSITION AS ordinal_position,
				COLUMN_NAME AS column_name,
				REFERENCED_TABLE_NAME AS referenced_table_name,
				REFERENCED_COLUMN_NAME AS referenced_column_name
		 FROM INFORMATION_SCHEMA.KEY_COLUMN_USAGE
		 WHERE CONSTRAINT_SCHEMA = DATABASE()
		   AND TABLE_NAME IN (${placeholders(PERSISTENCE_SCHEMA_TABLES.length)})`,
		[...PERSISTENCE_SCHEMA_TABLES],
	);
	const existingForeignKeyColumns = new Map<string, string[]>();
	for (const row of foreignKeyRows) {
		if (!row.referenced_table_name || !row.referenced_column_name) continue;
		const key = `${row.table_name}.${row.constraint_name}`;
		const columns = existingForeignKeyColumns.get(key) ?? [];
		columns[row.ordinal_position - 1] =
			`${row.column_name}->${row.referenced_table_name}.${row.referenced_column_name}`;
		existingForeignKeyColumns.set(key, columns);
	}
	for (const {
		table,
		name,
		columns,
		referencedTable,
		referencedColumns,
	} of PERSISTENCE_SCHEMA_FOREIGN_KEYS) {
		const key = `${table}.${name}`;
		const expected = columns.map(
			(column, index) =>
				`${column}->${referencedTable}.${referencedColumns[index]}`,
		);
		if (
			JSON.stringify(existingForeignKeyColumns.get(key) ?? []) !==
			JSON.stringify(expected)
		) {
			missing.push(`foreign-key:${key}`);
		}
	}

	return missing;
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
	const baseState = {
		expectedMigrationId:
			expectedMigrationIds.at(-1) ?? "no-migrations-configured",
		appliedMigrationIds: expectedMigrationIds.filter((id) => applied.has(id)),
		missingMigrationIds,
	};
	if (missingMigrationIds.length > 0) {
		return {
			status: "incomplete",
			...baseState,
			schemaStatus: "not_checked",
			missingSchemaObjects: [],
		};
	}

	const missingSchemaObjects = await readMissingSchemaObjects(pool);
	return {
		status: missingSchemaObjects.length === 0 ? "ready" : "incomplete",
		...baseState,
		schemaStatus: missingSchemaObjects.length === 0 ? "verified" : "incomplete",
		missingSchemaObjects,
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
	try {
		assertMigrationTargetAllowed(databaseUrl, Bun.env);
	} catch (error) {
		logger.error(
			{
				event: "persistence.migration.target_rejected",
				errorType: error instanceof Error ? error.name : "UnknownError",
			},
			"Persistence migration target rejected by safety gate",
		);
		throw error;
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
		// MySQL DDL 不能通过事务可靠回滚。每个迁移开始前先持久化执行标记，
		// 这样进程崩溃后运维仍有 durable evidence 可以判断迁移停在何处。
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
				// 如果进程已经写入 schema history、但还没记录成功就退出，迁移历史
				// 仍是权威事实；这里将执行状态补齐为成功，供后续 readiness 对账。
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
			// 这里不能包在 beginTransaction/rollback 中。MySQL DDL 可能隐式提交，
			// 表面上的 rollback 不能撤销结构变更，反而会制造虚假的安全感。
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
				// 迁移错误可能包含 SQL/驱动上下文；日志只保留类型，具体
				// 错误事实已经通过 migration run 状态和人工 recovery 流程处理。
				errorType: error instanceof Error ? error.name : "UnknownError",
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
