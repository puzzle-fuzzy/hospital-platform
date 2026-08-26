import type {
	HealthKnowledgeImportBundle,
	HealthKnowledgeImportItem,
	HealthKnowledgeImportSummary,
} from "@hospital/domain";
import {
	HealthKnowledgePublicationConflictError,
	validateHealthKnowledgeImportBundle,
} from "@hospital/domain";
import type { Pool, PoolConnection } from "mysql2/promise";

type QueryExecutor = {
	execute(
		sql: string,
		values?: readonly unknown[],
	): Promise<[unknown, readonly unknown[]]>;
};

type PublishedPublicationRow = {
	content_version: string;
	effective_from: Date | string | null;
	effective_to: Date | string | null;
};

// MySQL 命名锁用于串行化发布窗口检查，覆盖“当前没有 published 行”的首次导入竞争。
const HEALTH_KNOWLEDGE_PUBLICATION_LOCK_NAME =
	"hospital:health-knowledge:publication";
// 锁等待超时后直接拒绝本次导入，避免后台任务长期占用连接或悄悄绕过发布门禁。
const HEALTH_KNOWLEDGE_PUBLICATION_LOCK_TIMEOUT_SECONDS = 10;

function mysqlDateTime(value: string): string {
	const date = new Date(value);
	if (Number.isNaN(date.getTime())) {
		throw new Error("Health knowledge import received an invalid timestamp");
	}
	const pad = (part: number, length = 2) => String(part).padStart(length, "0");
	return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())} ${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())}:${pad(date.getUTCSeconds())}.${pad(date.getUTCMilliseconds(), 3)}`;
}

async function execute(
	client: PoolConnection,
	sql: string,
	values: readonly unknown[],
): Promise<void> {
	const executor = client as unknown as QueryExecutor;
	await executor.execute(sql, values);
}

async function queryRows<T>(
	client: PoolConnection,
	sql: string,
	values: readonly unknown[],
): Promise<T> {
	const executor = client as unknown as QueryExecutor;
	const [rows] = await executor.execute(sql, values);
	return rows as T;
}

function timestampFromDatabase(value: Date | string | null): number {
	if (value === null) {
		throw new HealthKnowledgePublicationConflictError();
	}
	const timestamp = value instanceof Date ? value.getTime() : Date.parse(value);
	if (!Number.isFinite(timestamp)) {
		// 已存在的 published 行如果连生效时间都无法解释，不能一边导入
		// 新版本一边掩盖旧数据损坏；继续写入只会让发布审计更难恢复。
		throw new HealthKnowledgePublicationConflictError();
	}
	return timestamp;
}

async function acquirePublicationLock(
	connection: PoolConnection,
): Promise<void> {
	const rows = await queryRows<
		ReadonlyArray<{ locked: number | string | null }>
	>(connection, "SELECT GET_LOCK(?, ?) AS locked", [
		HEALTH_KNOWLEDGE_PUBLICATION_LOCK_NAME,
		HEALTH_KNOWLEDGE_PUBLICATION_LOCK_TIMEOUT_SECONDS,
	]);
	if (Number(rows[0]?.locked) !== 1) {
		throw new HealthKnowledgePublicationConflictError();
	}
}

async function releasePublicationLock(
	connection: PoolConnection,
): Promise<void> {
	await execute(connection, "SELECT RELEASE_LOCK(?)", [
		HEALTH_KNOWLEDGE_PUBLICATION_LOCK_NAME,
	]);
}

/**
 * 在写入发布 bundle 前锁定已有 published 窗口并拒绝重叠版本。
 *
 * 读取 repository 已经有 fail-closed 保护，但只在患者请求到来时才发现
 * 冲突；如果导入任务先提交两个重叠版本，数据库会短暂处于不一致状态，
 * 还可能让发布人员误以为第二个版本已经成功上线。这里必须在同一事务
 * 中使用 `FOR UPDATE` 锁住现有 published 行，再按半开区间 `[from, to)`
 * 判断重叠；相邻版本首尾相接是合法的，真正重叠才拒绝。
 */
async function assertPublishedWindowAvailable(
	connection: PoolConnection,
	publication: HealthKnowledgeImportBundle["publication"],
): Promise<void> {
	if (publication.status !== "published") return;
	if (!publication.effectiveFrom) {
		// 领域校验已经会拒绝该输入；保留这里是为了防止未来其它调用路径
		// 绕过 validator 后把未定义时间带入 SQL 或日期比较。
		throw new HealthKnowledgePublicationConflictError();
	}

	const effectiveFrom = Date.parse(publication.effectiveFrom);
	const effectiveTo = publication.effectiveTo
		? Date.parse(publication.effectiveTo)
		: null;
	if (
		!Number.isFinite(effectiveFrom) ||
		(effectiveTo !== null && !Number.isFinite(effectiveTo))
	) {
		throw new HealthKnowledgePublicationConflictError();
	}

	const rows = await queryRows<PublishedPublicationRow[]>(
		connection,
		`SELECT content_version, effective_from, effective_to
			 FROM hp_health_knowledge_publications
			 WHERE status = 'published'
			 ORDER BY effective_from, content_version
			 FOR UPDATE`,
		[],
	);
	for (const row of rows) {
		const existingFrom = timestampFromDatabase(row.effective_from);
		const existingTo =
			row.effective_to === null
				? null
				: timestampFromDatabase(row.effective_to);
		const overlaps =
			(existingTo === null || existingTo > effectiveFrom) &&
			(effectiveTo === null || existingFrom < effectiveTo);
		if (overlaps) throw new HealthKnowledgePublicationConflictError();
	}
}

async function insertItem(
	connection: PoolConnection,
	contentVersion: string,
	item: HealthKnowledgeImportItem,
	timestamp: string,
): Promise<void> {
	await execute(
		connection,
		`INSERT INTO hp_health_knowledge_items
			(item_id, content_version, item_kind, name, initial_letter, created_at, updated_at)
			VALUES (?, ?, ?, ?, ?, ?, ?)`,
		[
			item.id,
			contentVersion,
			item.kind,
			item.name,
			item.initialLetter ?? null,
			timestamp,
			timestamp,
		],
	);
}

/**
 * 将一个经过领域校验的 bundle 原子写入 MySQL。
 *
 * 导入器没有默认数据、没有 upsert，也不改变患者端 gate；重复版本或外键
 * 错误会让事务回滚，调用方必须在人工审核后显式传入 bundle。
 */
export async function importHealthKnowledgeBundle(
	pool: Pool,
	bundle: HealthKnowledgeImportBundle,
): Promise<HealthKnowledgeImportSummary> {
	const summary = validateHealthKnowledgeImportBundle(bundle);
	const connection = await pool.getConnection();
	const timestamp = mysqlDateTime(new Date().toISOString());
	let publicationLockAcquired = false;

	try {
		await connection.beginTransaction();
		const { publication } = bundle;
		if (publication.status === "published") {
			await acquirePublicationLock(connection);
			publicationLockAcquired = true;
			await assertPublishedWindowAvailable(connection, publication);
		}
		await execute(
			connection,
			`INSERT INTO hp_health_knowledge_publications
				(content_version, status, source_label, reviewed_at, disclaimer,
				 reviewer_ref, effective_from, effective_to, created_at, updated_at)
				VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
			[
				publication.contentVersion,
				publication.status,
				publication.sourceLabel,
				mysqlDateTime(publication.reviewedAt),
				publication.disclaimer,
				publication.reviewerRef ?? null,
				publication.effectiveFrom
					? mysqlDateTime(publication.effectiveFrom)
					: null,
				publication.effectiveTo ? mysqlDateTime(publication.effectiveTo) : null,
				timestamp,
				timestamp,
			],
		);

		for (const item of bundle.items) {
			await insertItem(connection, publication.contentVersion, item, timestamp);
		}

		for (const detail of bundle.diseaseDetails) {
			await execute(
				connection,
				`INSERT INTO hp_health_knowledge_disease_details
					(disease_id, content_version, disease_alias, affected_part,
					 treatment_department, susceptible_crowd, cause, symptoms,
					 examination, prevention, treatment)
					VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
				[
					detail.id,
					publication.contentVersion,
					detail.diseaseAlias ?? null,
					detail.affectedPart ?? null,
					detail.treatmentDepartment ?? null,
					detail.susceptibleCrowd ?? null,
					detail.cause ?? null,
					detail.symptoms ?? null,
					detail.examination ?? null,
					detail.prevention ?? null,
					detail.treatment ?? null,
				],
			);
			for (const drug of detail.availableDrugs) {
				await execute(
					connection,
					`INSERT INTO hp_health_knowledge_disease_drugs
						(content_version, disease_id, drug_id, drug_name, is_clickable)
						VALUES (?, ?, ?, ?, ?)`,
					[
						publication.contentVersion,
						detail.id,
						drug.drugId ?? null,
						drug.drugName,
						drug.isClickable,
					],
				);
			}
		}

		for (const detail of bundle.drugDetails) {
			await execute(
				connection,
				`INSERT INTO hp_health_knowledge_drug_details
					(drug_id, content_version, manufacturer, chinese_name,
					 specifications, treatable_diseases, indications, usage_dosage,
					 adverse_reactions, contraindications, interactions, precautions)
					VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
				[
					detail.id,
					publication.contentVersion,
					detail.manufacturer ?? null,
					detail.chineseName ?? null,
					detail.specifications ?? null,
					detail.treatableDiseases ?? null,
					detail.indications ?? null,
					detail.usageDosage ?? null,
					detail.adverseReactions ?? null,
					detail.contraindications ?? null,
					detail.interactions ?? null,
					detail.precautions ?? null,
				],
			);
		}

		for (const relation of bundle.diseaseRelations) {
			await execute(
				connection,
				`INSERT INTO hp_health_knowledge_disease_relations
					(content_version, relation_kind, relation_id, disease_id)
					VALUES (?, ?, ?, ?)`,
				[
					publication.contentVersion,
					relation.kind,
					relation.relationId,
					relation.diseaseId,
				],
			);
		}

		for (const relation of bundle.partSymptoms) {
			await execute(
				connection,
				`INSERT INTO hp_health_knowledge_part_symptoms
					(content_version, part_id, symptom_id)
					VALUES (?, ?, ?)`,
				[publication.contentVersion, relation.partId, relation.symptomId],
			);
		}

		for (const relation of bundle.symptomDiseases) {
			await execute(
				connection,
				`INSERT INTO hp_health_knowledge_symptom_diseases
					(content_version, symptom_id, disease_id)
					VALUES (?, ?, ?)`,
				[publication.contentVersion, relation.symptomId, relation.diseaseId],
			);
		}

		await connection.commit();
		return summary;
	} catch (error) {
		await connection.rollback();
		throw error;
	} finally {
		if (publicationLockAcquired) {
			await releasePublicationLock(connection);
		}
		connection.release();
	}
}
