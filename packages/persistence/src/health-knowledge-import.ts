import type {
	HealthKnowledgeImportBundle,
	HealthKnowledgeImportItem,
	HealthKnowledgeImportSummary,
} from "@hospital/domain";
import { validateHealthKnowledgeImportBundle } from "@hospital/domain";
import type { Pool, PoolConnection } from "mysql2/promise";

type QueryExecutor = {
	execute(
		sql: string,
		values?: readonly unknown[],
	): Promise<[unknown, readonly unknown[]]>;
};

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

	try {
		await connection.beginTransaction();
		const { publication } = bundle;
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
		connection.release();
	}
}
