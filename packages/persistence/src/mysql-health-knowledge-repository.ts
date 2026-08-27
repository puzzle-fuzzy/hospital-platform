import type {
	HealthKnowledgeCatalogItem,
	HealthKnowledgeCatalogKind,
	HealthKnowledgeDiseaseDetail,
	HealthKnowledgeDiseaseRelation,
	HealthKnowledgeDiseaseSummary,
	HealthKnowledgeDocument,
	HealthKnowledgeDrugDetail,
	HealthKnowledgeDrugReference,
	HealthKnowledgeLetterItem,
	HealthKnowledgeListSnapshot,
	HealthKnowledgePublication,
	HealthKnowledgeRepository,
} from "@hospital/domain";
import {
	HEALTH_KNOWLEDGE_TEXT_LIMITS,
	HealthKnowledgeContentUnavailableError,
	HealthKnowledgePublicationConflictError,
	HealthKnowledgeResultValidationError,
	HealthKnowledgeValidationError,
	validateHealthKnowledgeIdentifier,
	validateHealthKnowledgeLetter,
	validateHealthKnowledgePublication,
	validateHealthKnowledgeSymptomIds,
} from "@hospital/domain";
import type { Pool, RowDataPacket } from "mysql2/promise";

/**
 * 列表只读取有界症状摘要；超过摘要上限的正文保留在详情接口中。
 *
 * 不能用 `LEFT()` 静默截断医疗正文：截断后的半句话可能改变用户理解。
 * 超限时返回 NULL，由领域层投影为缺省摘要；用户进入详情后仍可读取完整
 * 的、已经通过同一版本校验的正文。上限来自共享领域常量，避免 SQL、导入
 * 和公共 contract 各自维护不同数字。
 */
const DISEASE_SUMMARY_SYMPTOMS_PROJECTION = `CASE
	WHEN dd.symptoms IS NULL
		OR CHAR_LENGTH(dd.symptoms) <= ${HEALTH_KNOWLEDGE_TEXT_LIMITS.diseaseSummarySymptoms}
	THEN dd.symptoms
	ELSE NULL
END AS symptoms`;

/** MySQL DATETIME 没有时区；repository 边界统一转成领域层的 UTC ISO 字符串。 */
function invalidHealthKnowledgeResult(
	violation: ConstructorParameters<
		typeof HealthKnowledgeResultValidationError
	>[0],
): never {
	throw new HealthKnowledgeResultValidationError(violation);
}

function isoUtc(value: unknown): string {
	if (typeof value !== "string" && !(value instanceof Date)) {
		invalidHealthKnowledgeResult("publication-invalid");
	}
	if (value instanceof Date) {
		if (Number.isNaN(value.getTime())) {
			invalidHealthKnowledgeResult("publication-invalid");
		}
		return value.toISOString();
	}
	const normalized = value.includes("T")
		? /(?:Z|[+-]\d{2}:?\d{2})$/i.test(value)
			? value
			: `${value}Z`
		: `${value.replace(" ", "T")}Z`;
	const date = new Date(normalized);
	if (Number.isNaN(date.getTime())) {
		invalidHealthKnowledgeResult("publication-invalid");
	}
	return date.toISOString();
}

function optionalText(value: unknown): string | undefined {
	if (value !== null && typeof value !== "string") {
		invalidHealthKnowledgeResult("document-item-invalid");
	}
	return value === null || value.trim().length === 0 ? undefined : value;
}

function optionalTextField<Key extends string>(
	key: Key,
	value: unknown,
): { [K in Key]?: string } {
	const normalized = optionalText(value);
	return normalized ? ({ [key]: normalized } as { [K in Key]?: string }) : {};
}

/** MySQL BOOLEAN 通常以 0/1 返回；未知值不能静默当成 false。 */
function booleanValue(value: unknown): boolean {
	if (typeof value === "boolean") return value;
	if (typeof value === "number" && (value === 0 || value === 1)) {
		return value === 1;
	}
	if (value === "0" || value === "1") return value === "1";
	throw new Error("Persistence returned an invalid health knowledge boolean");
}

function assertCatalogKind(
	value: string,
): asserts value is HealthKnowledgeCatalogKind {
	if (value !== "crowd" && value !== "department" && value !== "part") {
		throw new HealthKnowledgeValidationError("invalid_identifier");
	}
}

function assertRelationKind(
	value: string,
): asserts value is HealthKnowledgeDiseaseRelation["kind"] {
	assertCatalogKind(value);
}

type PublishedPublicationRow = RowDataPacket & {
	content_version: string;
	status: string;
	source_label: string;
	reviewed_at: string | Date;
	disclaimer: string;
};

type CatalogRow = RowDataPacket & {
	item_id: string;
	name: string;
};

type LetterRow = RowDataPacket & {
	item_id: string;
	name: string;
	initial_letter: string | null;
};

type DiseaseSummaryRow = LetterRow & {
	treatment_department: string | null;
	symptoms: string | null;
};

type DiseaseDetailRow = RowDataPacket & {
	disease_id: string;
	disease_name: string;
	disease_alias: string | null;
	affected_part: string | null;
	treatment_department: string | null;
	susceptible_crowd: string | null;
	cause: string | null;
	symptoms: string | null;
	examination: string | null;
	prevention: string | null;
	treatment: string | null;
};

type DiseaseDrugRow = RowDataPacket & {
	drug_id: string | null;
	drug_item_kind: string | null;
	drug_name: string;
	is_clickable: boolean | number | string;
};

type DrugDetailRow = RowDataPacket & {
	drug_id: string;
	drug_name: string;
	manufacturer: string | null;
	chinese_name: string | null;
	specifications: string | null;
	treatable_diseases: string | null;
	indications: string | null;
	usage_dosage: string | null;
	adverse_reactions: string | null;
	contraindications: string | null;
	interactions: string | null;
	precautions: string | null;
};

type QueryExecutor = {
	execute(
		sql: string,
		values?: readonly unknown[],
	): Promise<[unknown, readonly unknown[]]>;
};

async function execute<T extends RowDataPacket[]>(
	pool: Pool,
	sql: string,
	values: readonly unknown[] = [],
): Promise<T> {
	const executor = pool as unknown as QueryExecutor;
	const [rows] = await executor.execute(sql, values);
	return rows as T;
}

function publicationFromRow(
	row: PublishedPublicationRow,
): HealthKnowledgePublication {
	if (
		typeof row.content_version !== "string" ||
		typeof row.status !== "string" ||
		typeof row.source_label !== "string" ||
		typeof row.disclaimer !== "string"
	) {
		invalidHealthKnowledgeResult("publication-invalid");
	}
	if (row.status !== "published") {
		invalidHealthKnowledgeResult("publication-invalid");
	}
	const publication: HealthKnowledgePublication = {
		contentVersion: row.content_version,
		reviewedAt: isoUtc(row.reviewed_at),
		sourceLabel: row.source_label,
		disclaimer: row.disclaimer,
	};
	try {
		validateHealthKnowledgePublication(publication);
	} catch {
		// 数据库发布行属于持久化读模型，不是患者提交的查询参数；坏行
		// 必须映射为 500 persistence-invalid，不能被 API 当作 400 查询错误。
		invalidHealthKnowledgeResult("publication-invalid");
	}
	return publication;
}

function letterItem(row: LetterRow): HealthKnowledgeLetterItem {
	if (
		typeof row.item_id !== "string" ||
		typeof row.name !== "string" ||
		(row.initial_letter !== null && typeof row.initial_letter !== "string")
	) {
		invalidHealthKnowledgeResult("letter-item-invalid");
	}
	const item: HealthKnowledgeLetterItem = {
		id: row.item_id,
		name: row.name,
		initialLetter: row.initial_letter?.trim() || "#",
	};
	try {
		validateHealthKnowledgeLetter(item);
	} catch {
		invalidHealthKnowledgeResult("letter-item-invalid");
	}
	return item;
}

function catalogItem(row: CatalogRow): HealthKnowledgeCatalogItem {
	if (typeof row.item_id !== "string" || typeof row.name !== "string") {
		invalidHealthKnowledgeResult("catalog-item-invalid");
	}
	try {
		validateHealthKnowledgeIdentifier(row.item_id);
		if (
			row.name.trim().length === 0 ||
			row.name.length > HEALTH_KNOWLEDGE_TEXT_LIMITS.itemName
		) {
			throw new HealthKnowledgeValidationError("invalid_identifier");
		}
	} catch {
		invalidHealthKnowledgeResult("catalog-item-invalid");
	}
	return { id: row.item_id, name: row.name };
}

function diseaseSummary(row: DiseaseSummaryRow): HealthKnowledgeDiseaseSummary {
	const item: HealthKnowledgeDiseaseSummary = {
		...letterItem(row),
		...optionalTextField("treatmentDepartment", row.treatment_department),
		...optionalTextField("symptoms", row.symptoms),
	};
	return item;
}

function diseaseDetail(
	row: DiseaseDetailRow,
	drugs: readonly HealthKnowledgeDrugReference[],
): HealthKnowledgeDiseaseDetail {
	return {
		id: row.disease_id,
		diseaseName: row.disease_name,
		...optionalTextField("diseaseAlias", row.disease_alias),
		...optionalTextField("affectedPart", row.affected_part),
		...optionalTextField("treatmentDepartment", row.treatment_department),
		...optionalTextField("susceptibleCrowd", row.susceptible_crowd),
		availableDrugs: drugs,
		...optionalTextField("cause", row.cause),
		...optionalTextField("symptoms", row.symptoms),
		...optionalTextField("examination", row.examination),
		...optionalTextField("prevention", row.prevention),
		...optionalTextField("treatment", row.treatment),
	};
}

function drugDetail(row: DrugDetailRow): HealthKnowledgeDrugDetail {
	return {
		id: row.drug_id,
		drugName: row.drug_name,
		...optionalTextField("manufacturer", row.manufacturer),
		...optionalTextField("chineseName", row.chinese_name),
		...optionalTextField("specifications", row.specifications),
		...optionalTextField("treatableDiseases", row.treatable_diseases),
		...optionalTextField("indications", row.indications),
		...optionalTextField("usageDosage", row.usage_dosage),
		...optionalTextField("adverseReactions", row.adverse_reactions),
		...optionalTextField("contraindications", row.contraindications),
		...optionalTextField("interactions", row.interactions),
		...optionalTextField("precautions", row.precautions),
	};
}

/**
 * 已发布版本优先于具体查询，确保一次读取不会把不同审核版本拼在一起。
 * 所有后续 SQL 都显式携带 content_version，避免“最新版本”竞态污染结果。
 */
export function createMySqlHealthKnowledgeRepository(
	pool: Pool,
): HealthKnowledgeRepository {
	const readPublishedPublication =
		async (): Promise<HealthKnowledgePublication> => {
			const rows = await execute<PublishedPublicationRow[]>(
				pool,
				`SELECT content_version, status, source_label, reviewed_at, disclaimer
				 FROM hp_health_knowledge_publications
				 WHERE status = 'published'
				   AND effective_from <= UTC_TIMESTAMP(3)
				   AND (effective_to IS NULL OR effective_to > UTC_TIMESTAMP(3))
				 ORDER BY reviewed_at DESC, content_version DESC
				 LIMIT 2`,
			);
			if (rows.length > 1) {
				// 读取层不能用 ORDER BY + LIMIT 1 掩盖两个版本的窗口冲突。
				// 这里主动 fail-closed，等待发布任务修正 effectiveFrom/effectiveTo
				// 或撤回多余版本后再恢复患者端读取。
				throw new HealthKnowledgePublicationConflictError();
			}
			const row = rows[0];
			if (!row) throw new HealthKnowledgeContentUnavailableError();
			return publicationFromRow(row);
		};

	return {
		async listCatalog(kind) {
			assertCatalogKind(kind);
			const publication = await readPublishedPublication();
			const rows = await execute<CatalogRow[]>(
				pool,
				`SELECT item_id, name
				 FROM hp_health_knowledge_items
				 WHERE content_version = ? AND item_kind = ?
				 ORDER BY name, item_id`,
				[publication.contentVersion, kind],
			);
			const items: HealthKnowledgeCatalogItem[] = rows.map(catalogItem);
			return {
				publication,
				items,
			} satisfies HealthKnowledgeListSnapshot<HealthKnowledgeCatalogItem>;
		},

		async listDiseasesByRelation(relation) {
			assertRelationKind(relation.kind);
			validateHealthKnowledgeIdentifier(relation.id);
			const publication = await readPublishedPublication();
			const rows = await execute<DiseaseSummaryRow[]>(
				pool,
				`SELECT d.item_id, d.name,
						d.initial_letter, dd.treatment_department,
						${DISEASE_SUMMARY_SYMPTOMS_PROJECTION}
				 FROM hp_health_knowledge_disease_relations AS r
				 JOIN hp_health_knowledge_items AS relation_item
				   ON relation_item.item_id = r.relation_id
				  AND relation_item.content_version = r.content_version
				  AND relation_item.item_kind = r.relation_kind
				 JOIN hp_health_knowledge_items AS d
				   ON d.item_id = r.disease_id
				  AND d.content_version = r.content_version
				  AND d.item_kind = 'disease'
				 LEFT JOIN hp_health_knowledge_disease_details AS dd
				   ON dd.disease_id = d.item_id
				  AND dd.content_version = r.content_version
				 WHERE r.content_version = ?
				   AND r.relation_kind = ?
				   AND r.relation_id = ?
				 ORDER BY d.name, d.item_id`,
				[publication.contentVersion, relation.kind, relation.id],
			);
			return {
				publication,
				items: rows.map(diseaseSummary),
			} satisfies HealthKnowledgeListSnapshot<HealthKnowledgeDiseaseSummary>;
		},

		async listSymptomsByPart(partId) {
			validateHealthKnowledgeIdentifier(partId);
			const publication = await readPublishedPublication();
			const rows = await execute<LetterRow[]>(
				pool,
				`SELECT s.item_id, s.name, s.initial_letter
				 FROM hp_health_knowledge_part_symptoms AS ps
				 JOIN hp_health_knowledge_items AS p
				   ON p.item_id = ps.part_id
				  AND p.content_version = ps.content_version
				  AND p.item_kind = 'part'
				 JOIN hp_health_knowledge_items AS s
				   ON s.item_id = ps.symptom_id
				  AND s.content_version = ps.content_version
				  AND s.item_kind = 'symptom'
				 WHERE ps.content_version = ? AND ps.part_id = ?
				 ORDER BY s.name, s.item_id`,
				[publication.contentVersion, partId],
			);
			return {
				publication,
				items: rows.map(letterItem),
			} satisfies HealthKnowledgeListSnapshot<HealthKnowledgeLetterItem>;
		},

		async listDiseasesBySymptoms(symptomIds) {
			validateHealthKnowledgeSymptomIds(symptomIds);
			const publication = await readPublishedPublication();
			const placeholders = symptomIds.map(() => "?").join(", ");
			const rows = await execute<DiseaseSummaryRow[]>(
				pool,
				`SELECT d.item_id, d.name,
						d.initial_letter, dd.treatment_department,
						${DISEASE_SUMMARY_SYMPTOMS_PROJECTION}
				 FROM hp_health_knowledge_symptom_diseases AS sd
				 JOIN hp_health_knowledge_items AS s
				   ON s.item_id = sd.symptom_id
				  AND s.content_version = sd.content_version
				  AND s.item_kind = 'symptom'
				 JOIN hp_health_knowledge_items AS d
				   ON d.item_id = sd.disease_id
				  AND d.content_version = sd.content_version
				  AND d.item_kind = 'disease'
				 LEFT JOIN hp_health_knowledge_disease_details AS dd
				   ON dd.disease_id = d.item_id
				  AND dd.content_version = sd.content_version
				 WHERE sd.content_version = ?
				   AND sd.symptom_id IN (${placeholders})
				 GROUP BY d.item_id, d.name, d.initial_letter,
						dd.treatment_department, dd.symptoms
				 HAVING COUNT(DISTINCT sd.symptom_id) = ?
				 ORDER BY d.name, d.item_id`,
				[publication.contentVersion, ...symptomIds, symptomIds.length],
			);
			return {
				publication,
				items: rows.map(diseaseSummary),
			} satisfies HealthKnowledgeListSnapshot<HealthKnowledgeDiseaseSummary>;
		},

		async getDiseaseDetail(diseaseId) {
			validateHealthKnowledgeIdentifier(diseaseId);
			const publication = await readPublishedPublication();
			const rows = await execute<DiseaseDetailRow[]>(
				pool,
				`SELECT d.item_id AS disease_id, d.name AS disease_name,
						dd.disease_alias, dd.affected_part, dd.treatment_department,
						dd.susceptible_crowd, dd.cause, dd.symptoms, dd.examination,
						dd.prevention, dd.treatment
				 FROM hp_health_knowledge_items AS d
				 JOIN hp_health_knowledge_disease_details AS dd
				   ON dd.disease_id = d.item_id
				  AND dd.content_version = d.content_version
				 WHERE d.content_version = ?
				   AND d.item_id = ?
				   AND d.item_kind = 'disease'
				 LIMIT 1`,
				[publication.contentVersion, diseaseId],
			);
			const row = rows[0];
			if (!row) return undefined;
			const drugRows = await execute<DiseaseDrugRow[]>(
				pool,
				`SELECT dd.drug_id, drug.item_kind AS drug_item_kind,
						dd.drug_name, dd.is_clickable
				 FROM hp_health_knowledge_disease_drugs AS dd
				 LEFT JOIN hp_health_knowledge_items AS drug
				   ON drug.item_id = dd.drug_id
				  AND drug.content_version = dd.content_version
				 WHERE dd.content_version = ? AND dd.disease_id = ?
				 ORDER BY drug_name`,
				[publication.contentVersion, diseaseId],
			);
			const drugs = drugRows.map((drug): HealthKnowledgeDrugReference => {
				if (drug.drug_id !== null && drug.drug_item_kind !== "drug") {
					// 外键只证明 item 存在，不证明它是药品；错误类别不能
					// 继续进入患者端的“可点击药品”读模型。
					throw new Error(
						"Persistence returned a health knowledge reference with an invalid drug kind",
					);
				}
				const isClickable = booleanValue(drug.is_clickable);
				if (isClickable) {
					// 数据库中的可点击标记必须和同版本药品主键成对出现，
					// 否则详情页不能安全地生成药品跳转入口。
					if (drug.drug_id === null) {
						throw new Error(
							"Persistence returned a clickable health knowledge reference without a drug id",
						);
					}
					return {
						drugId: drug.drug_id,
						drugName: drug.drug_name,
						isClickable: true,
					};
				}
				return {
					...(drug.drug_id ? { drugId: drug.drug_id } : {}),
					drugName: drug.drug_name,
					isClickable: false,
				};
			});
			const item = diseaseDetail(row, drugs);
			return {
				publication,
				item,
			} satisfies HealthKnowledgeDocument<HealthKnowledgeDiseaseDetail>;
		},

		async getDrugDetail(drugId) {
			validateHealthKnowledgeIdentifier(drugId);
			const publication = await readPublishedPublication();
			const rows = await execute<DrugDetailRow[]>(
				pool,
				`SELECT d.item_id AS drug_id, d.name AS drug_name,
						dr.manufacturer, dr.chinese_name, dr.specifications,
						dr.treatable_diseases, dr.indications, dr.usage_dosage,
						dr.adverse_reactions, dr.contraindications, dr.interactions,
						dr.precautions
				 FROM hp_health_knowledge_items AS d
				 JOIN hp_health_knowledge_drug_details AS dr
				   ON dr.drug_id = d.item_id
				  AND dr.content_version = d.content_version
				 WHERE d.content_version = ?
				   AND d.item_id = ?
				   AND d.item_kind = 'drug'
				 LIMIT 1`,
				[publication.contentVersion, drugId],
			);
			const row = rows[0];
			if (!row) return undefined;
			return {
				publication,
				item: drugDetail(row),
			} satisfies HealthKnowledgeDocument<HealthKnowledgeDrugDetail>;
		},
	};
}
