import { createPool, type Pool, type RowDataPacket } from "mysql2/promise";

/**
 * 旧便民表的固定白名单。
 *
 * 表名不是用户输入，必须维护为代码常量；审计脚本不能接受任意表名，
 * 否则一个本来只读的诊断命令也可能被误用来扫描系统表或业务敏感表。
 */
export const LEGACY_CONVENIENCE_TABLES = Object.freeze([
	{
		table: "admission_preconsultation",
		kind: "patient-questionnaire",
		patientColumn: "pat_id",
	},
	{
		table: "commendatory_letter",
		kind: "patient-feedback",
		patientColumn: null,
	},
	{
		table: "discharge_follow_up",
		kind: "patient-questionnaire",
		patientColumn: "pat_id",
	},
	{
		table: "my_doctor",
		kind: "doctor-relation",
		patientColumn: null,
	},
	{
		table: "risk_assessment",
		kind: "patient-questionnaire",
		patientColumn: "pat_id",
	},
	{
		table: "silk_banner",
		kind: "patient-feedback",
		patientColumn: null,
	},
] as const);

const TARGET_IDENTITY_TABLES = Object.freeze([
	"system_users",
	"hp_identity_users",
	"hp_patient_provider_references",
] as const);

type LegacyConvenienceTable = (typeof LEGACY_CONVENIENCE_TABLES)[number];

type TableRow = RowDataPacket & {
	tableName: string;
};

type AggregateRow = RowDataPacket & {
	total: number | string;
	ownerBridgeMapped: number | string;
	patientReferenceMapped: number | string;
};

export type LegacyConvenienceTableAudit = {
	table: string;
	kind: LegacyConvenienceTable["kind"];
	status:
		| "mapped"
		| "owner-mapped-patient-contract-pending"
		| "source-table-missing";
	totalRows: number;
	ownerBridgeMappedRows: number;
	ownerBridgeUnmappedRows: number;
	patientReferenceMappedRows: number;
	patientReferenceUnmappedRows: number;
	patientReferenceScope: "applicable" | "not-applicable";
	/** 只输出稳定的缺口分类，不输出旧 user_id、pat_id 或患者正文。 */
	missingReason: string;
};

export type LegacyConvenienceSourceAudit = {
	schemaVersion: 1;
	generatedAt: string;
	readOnly: true;
	targetSchemaReady: boolean;
	targetSchemaMissingTables: readonly string[];
	sourceTables: readonly LegacyConvenienceTableAudit[];
	totals: {
		totalRows: number;
		ownerBridgeMappedRows: number;
		patientReferenceMappedRows: number;
	};
	/** 只有所有行都有明确业务契约后才可能为 true，本工具不会自动开放页面。 */
	readyForReadOnlyMigration: false;
};

function requiredDatabaseUrl(): string {
	const value = process.env.DATABASE_URL?.trim();
	if (!value) {
		throw new Error("DATABASE_URL is required");
	}
	return value;
}

/**
 * 使用单连接池执行 SELECT。
 *
 * 这个脚本的目的只是把“旧库存”和“新身份/患者映射”对齐，故连接池固定
 * 为 1，避免维护命令在生产环境占用一批连接。脚本中没有 INSERT、UPDATE、
 * DELETE、DDL 或事务提交路径。
 */
function createReadOnlyPool(databaseUrl: string): Pool {
	const parsed = new URL(databaseUrl);
	if (parsed.protocol !== "mysql:") {
		throw new Error("DATABASE_URL must use mysql:// for legacy audit");
	}
	if (!parsed.hostname || !parsed.pathname.slice(1)) {
		throw new Error("DATABASE_URL must include a host and database");
	}
	return createPool({
		host: parsed.hostname,
		port: Number(parsed.port || 3306),
		user: decodeURIComponent(parsed.username),
		password: decodeURIComponent(parsed.password),
		database: decodeURIComponent(parsed.pathname.slice(1)),
		connectionLimit: 1,
		connectTimeout: 3_000,
		dateStrings: true,
	});
}

async function select<T extends RowDataPacket>(
	pool: Pick<Pool, "execute">,
	sql: string,
	values: readonly unknown[] = [],
): Promise<T[]> {
	const [rows] = await pool.execute<T[]>(sql, values);
	return rows;
}

async function existingTables(pool: Pool): Promise<ReadonlySet<string>> {
	const names = [
		...TARGET_IDENTITY_TABLES,
		...LEGACY_CONVENIENCE_TABLES.map(({ table }) => table),
	];
	const placeholders = names.map(() => "?").join(", ");
	const rows = await select<TableRow>(
		pool,
		`SELECT TABLE_NAME AS tableName
		 FROM information_schema.tables
		 WHERE TABLE_SCHEMA = DATABASE()
		   AND TABLE_NAME IN (${placeholders})`,
		names,
	);
	return new Set(rows.map((row) => row.tableName));
}

function toSafeCount(value: number | string | null | undefined): number {
	const parsed = typeof value === "number" ? value : Number(value ?? 0);
	if (!Number.isSafeInteger(parsed) || parsed < 0) {
		throw new Error(
			"Legacy convenience audit returned an invalid aggregate count",
		);
	}
	return parsed;
}

/**
 * 生成固定的 owner 映射 SQL。
 *
 * 旧表的 `user_id` 不能直接和新 opaque `userId` 比较。只有旧
 * `system_users.openid` 与新 `hp_identity_users.provider_subject` 对上时，
 * 才能证明这行记录属于当前平台 owner；任何缺桥接行都必须单独计为缺口。
 */
function aggregateSql(table: LegacyConvenienceTable): string {
	const patientReferenceExpression = table.patientColumn
		? `SUM(CASE WHEN hp.user_id IS NOT NULL
			AND ref.provider_patient_id IS NOT NULL THEN 1 ELSE 0 END)`
		: "0";
	const patientJoin = table.patientColumn
		? `LEFT JOIN hp_patient_provider_references AS ref
			ON ref.owner_user_id = hp.user_id
			AND ref.provider_name = 'zhongyang'
			AND ref.reference_kind = 'his-patient'
			AND ref.provider_patient_id = CAST(legacy.${table.patientColumn} AS CHAR)`
		: "";
	return `SELECT
		COUNT(*) AS total,
		COALESCE(SUM(CASE WHEN hp.user_id IS NOT NULL THEN 1 ELSE 0 END), 0)
			AS ownerBridgeMapped,
		COALESCE(${patientReferenceExpression}, 0) AS patientReferenceMapped
	FROM \`${table.table}\` AS legacy
	LEFT JOIN system_users AS old_user ON old_user.id = legacy.user_id
	LEFT JOIN hp_identity_users AS hp
		ON hp.provider_subject = old_user.openid
	${patientJoin}`;
}

export function classifyLegacyConvenienceTableAudit(
	table: LegacyConvenienceTable,
	totalRows: number,
	ownerBridgeMappedRows: number,
): Pick<LegacyConvenienceTableAudit, "status" | "missingReason"> {
	if (table.kind === "patient-questionnaire") {
		return {
			status: "owner-mapped-patient-contract-pending",
			missingReason:
				"问卷需要版本、任务/就诊引用、患者映射和临床审核；映射数量不能直接开放写入或展示正文",
		};
	}
	if (table.kind === "patient-feedback") {
		return {
			status: "owner-mapped-patient-contract-pending",
			missingReason:
				"旧 patient_id/就诊/医护字段未形成新 encounter contract，内容审核、脱敏和撤回仍未确认",
		};
	}
	if (ownerBridgeMappedRows !== totalRows) {
		return {
			status: "owner-mapped-patient-contract-pending",
			missingReason: "旧 user_id 尚未全部桥接到当前微信 owner",
		};
	}
	return {
		status: "owner-mapped-patient-contract-pending",
		missingReason:
			"医生关系仍需要受控医生目录、关系失效和展示字段白名单；旧快照不能直接视为当前关系",
	};
}

async function auditTable(
	pool: Pool,
	table: LegacyConvenienceTable,
	presentTables: ReadonlySet<string>,
): Promise<LegacyConvenienceTableAudit> {
	if (!presentTables.has(table.table)) {
		return {
			table: table.table,
			kind: table.kind,
			status: "source-table-missing",
			totalRows: 0,
			ownerBridgeMappedRows: 0,
			ownerBridgeUnmappedRows: 0,
			patientReferenceMappedRows: 0,
			patientReferenceUnmappedRows: 0,
			patientReferenceScope: table.patientColumn
				? "applicable"
				: "not-applicable",
			missingReason: "旧源表不存在，不能把缺表误判为合法空列表",
		};
	}

	const [row] = await select<AggregateRow>(pool, aggregateSql(table));
	if (!row)
		throw new Error(`Legacy convenience audit returned no row: ${table.table}`);
	const totalRows = toSafeCount(row.total);
	const ownerBridgeMappedRows = toSafeCount(row.ownerBridgeMapped);
	const patientReferenceMappedRows = toSafeCount(row.patientReferenceMapped);
	const state = classifyLegacyConvenienceTableAudit(
		table,
		totalRows,
		ownerBridgeMappedRows,
	);
	return {
		table: table.table,
		kind: table.kind,
		...state,
		totalRows,
		ownerBridgeMappedRows,
		ownerBridgeUnmappedRows: totalRows - ownerBridgeMappedRows,
		patientReferenceMappedRows,
		patientReferenceUnmappedRows: table.patientColumn
			? totalRows - patientReferenceMappedRows
			: 0,
		patientReferenceScope: table.patientColumn
			? "applicable"
			: "not-applicable",
	};
}

/**
 * 执行只读库存审计。
 *
 * `readyForReadOnlyMigration` 固定为 false 是有意的：即使所有数量都能桥接，
 * 也不能用一个统计脚本跳过 contract、字段白名单、审核和真机验收。
 */
export async function buildLegacyConvenienceSourceAudit(
	databaseUrl = requiredDatabaseUrl(),
): Promise<LegacyConvenienceSourceAudit> {
	const pool = createReadOnlyPool(databaseUrl);
	try {
		const presentTables = await existingTables(pool);
		const missingTargetTables = TARGET_IDENTITY_TABLES.filter(
			(table) => !presentTables.has(table),
		);
		if (missingTargetTables.length > 0) {
			throw new Error(
				`Legacy convenience audit target schema is incomplete: ${missingTargetTables.join(",")}`,
			);
		}

		const sourceTables = await Promise.all(
			LEGACY_CONVENIENCE_TABLES.map((table) =>
				auditTable(pool, table, presentTables),
			),
		);
		const totals = sourceTables.reduce(
			(accumulator, table) => ({
				totalRows: accumulator.totalRows + table.totalRows,
				ownerBridgeMappedRows:
					accumulator.ownerBridgeMappedRows + table.ownerBridgeMappedRows,
				patientReferenceMappedRows:
					accumulator.patientReferenceMappedRows +
					table.patientReferenceMappedRows,
			}),
			{ totalRows: 0, ownerBridgeMappedRows: 0, patientReferenceMappedRows: 0 },
		);
		return {
			schemaVersion: 1,
			generatedAt: new Date().toISOString(),
			readOnly: true,
			targetSchemaReady: true,
			targetSchemaMissingTables: [],
			sourceTables,
			totals,
			readyForReadOnlyMigration: false,
		};
	} finally {
		await pool.end();
	}
}

if (import.meta.main) {
	try {
		const report = await buildLegacyConvenienceSourceAudit();
		// 只输出数量、状态和稳定缺口；绝不打印旧 user_id、pat_id、正文或连接串。
		console.log(JSON.stringify(report, null, 2));
		if (
			report.sourceTables.some(
				(table) => table.status === "source-table-missing",
			)
		) {
			process.exitCode = 1;
		}
	} catch (error) {
		console.error(
			JSON.stringify({
				passed: false,
				errorType: error instanceof Error ? error.name : "UnknownError",
				message: error instanceof Error ? error.message : "unknown error",
			}),
		);
		process.exitCode = 1;
	}
}
