/**
 * 健康知识域的内容边界。
 *
 * 这里描述的是“已审核内容”的领域形态，不包含患者病历、provider 字段
 * 或 AI 生成结果。真实 repository 接入前，所有调用都必须保持 fail-closed。
 */

/** 患者端第一阶段只读的知识分类；自测和 AI 不与百科目录共用分类。 */
export type HealthKnowledgeCatalogKind = "crowd" | "department" | "part";

/** 内容发布时必须随读模型返回的可追溯元数据。 */
export type HealthKnowledgePublication = {
	contentVersion: string;
	reviewedAt: string;
	sourceLabel: string;
	disclaimer: string;
};

/** 健康知识统一免责声明；正文不能覆盖或删除该边界。 */
export const HEALTH_KNOWLEDGE_DISCLAIMER =
	"本内容仅供健康知识参考，不能替代医生诊断、处方或面对面就医。";

export type HealthKnowledgeCatalogItem = {
	id: string;
	name: string;
};

/** 疾病和症状列表保留首字母，分组展示由 API/小程序决定。 */
export type HealthKnowledgeLetterItem = HealthKnowledgeCatalogItem & {
	initialLetter: string;
};

export type HealthKnowledgeDiseaseSummary = HealthKnowledgeLetterItem & {
	treatmentDepartment?: string;
	symptoms?: string;
};

/** 疾病详情中的药品引用不是处方建议，只表示知识内容中的关联条目。 */
export type HealthKnowledgeDrugReference = {
	drugId?: string;
	drugName: string;
	isClickable: boolean;
};

export type HealthKnowledgeDiseaseDetail = {
	id: string;
	diseaseName: string;
	diseaseAlias?: string;
	affectedPart?: string;
	treatmentDepartment?: string;
	susceptibleCrowd?: string;
	availableDrugs: readonly HealthKnowledgeDrugReference[];
	cause?: string;
	symptoms?: string;
	examination?: string;
	prevention?: string;
	treatment?: string;
};

export type HealthKnowledgeDrugDetail = {
	id: string;
	drugName: string;
	manufacturer?: string;
	chineseName?: string;
	specifications?: string;
	treatableDiseases?: string;
	indications?: string;
	usageDosage?: string;
	adverseReactions?: string;
	contraindications?: string;
	interactions?: string;
	precautions?: string;
};

export type HealthKnowledgeListSnapshot<T> = {
	publication: HealthKnowledgePublication;
	items: readonly T[];
};

export type HealthKnowledgeDocument<T> = {
	publication: HealthKnowledgePublication;
	item: T;
};

export type HealthKnowledgeDiseaseRelation = {
	kind: "crowd" | "department" | "part";
	id: string;
};

export type HealthKnowledgeValidationReason =
	| "invalid_publication"
	| "invalid_identifier"
	| "invalid_initial_letter"
	| "invalid_symptom_query";

export class HealthKnowledgeValidationError extends Error {
	readonly reason: HealthKnowledgeValidationReason;

	constructor(reason: HealthKnowledgeValidationReason) {
		super(`Invalid health knowledge value: ${reason}`);
		this.name = "HealthKnowledgeValidationError";
		this.reason = reason;
	}
}

function assertBoundedText(
	value: string,
	maxLength: number,
	reason: HealthKnowledgeValidationReason,
): void {
	if (
		typeof value !== "string" ||
		value.trim().length === 0 ||
		value.length > maxLength
	) {
		throw new HealthKnowledgeValidationError(reason);
	}
}

/**
 * 发布元数据必须完整且可追溯；这里不验证“医学内容是否正确”，那是人工审核职责。
 */
export function validateHealthKnowledgePublication(
	publication: HealthKnowledgePublication,
): void {
	assertBoundedText(publication.contentVersion, 64, "invalid_publication");
	assertBoundedText(publication.sourceLabel, 128, "invalid_publication");
	assertBoundedText(publication.disclaimer, 512, "invalid_publication");
	// 患者端安全文案由代码固定，内容导入不能通过数据库字段覆盖它。
	if (publication.disclaimer !== HEALTH_KNOWLEDGE_DISCLAIMER) {
		throw new HealthKnowledgeValidationError("invalid_publication");
	}
	if (!Number.isFinite(Date.parse(publication.reviewedAt))) {
		throw new HealthKnowledgeValidationError("invalid_publication");
	}
}

/** 所有对外引用先经过统一长度校验，避免把数据库任意字段当成公开资源 id。 */
export function validateHealthKnowledgeIdentifier(value: string): void {
	assertBoundedText(value, 128, "invalid_identifier");
}

export function validateHealthKnowledgeLetter(
	value: HealthKnowledgeLetterItem,
): void {
	validateHealthKnowledgeIdentifier(value.id);
	assertBoundedText(value.name, 256, "invalid_identifier");
	if (
		typeof value.initialLetter !== "string" ||
		value.initialLetter.trim().length === 0 ||
		value.initialLetter.length > 8
	) {
		throw new HealthKnowledgeValidationError("invalid_initial_letter");
	}
}

/** 旧接口允许按多个症状筛选；平台把数量和重复值限制在领域层。 */
export function validateHealthKnowledgeSymptomIds(
	symptomIds: readonly string[],
): void {
	if (
		symptomIds.length === 0 ||
		symptomIds.length > 10 ||
		new Set(symptomIds).size !== symptomIds.length
	) {
		throw new HealthKnowledgeValidationError("invalid_symptom_query");
	}
	for (const symptomId of symptomIds) {
		validateHealthKnowledgeIdentifier(symptomId);
	}
}

/**
 * 统一的首字母分组工具只做展示结构整理，不参与疾病判断或医疗推断。
 * 空值使用 #，并对分组键排序，保证不同数据库实现返回稳定结果。
 */
export function groupHealthKnowledgeByInitialLetter<
	T extends { initialLetter?: string },
>(items: readonly T[]): Record<string, T[]> {
	const groups: Record<string, T[]> = {};
	for (const item of items) {
		const initialLetter = item.initialLetter?.trim().toUpperCase() || "#";
		const group = groups[initialLetter] ?? [];
		group.push(item);
		groups[initialLetter] = group;
	}
	return Object.fromEntries(
		Object.entries(groups).sort(([left], [right]) =>
			left.localeCompare(right, "en"),
		),
	) as Record<string, T[]>;
}

/**
 * repository 只提供已发布内容；草稿、撤回版本和后台审核字段不应穿过此端口。
 * 真实实现必须使用 MySQL，内存数据只能存在测试边界。
 */
export interface HealthKnowledgeRepository {
	listCatalog(
		kind: HealthKnowledgeCatalogKind,
	): Promise<HealthKnowledgeListSnapshot<HealthKnowledgeCatalogItem>>;
	listDiseasesByRelation(
		relation: HealthKnowledgeDiseaseRelation,
	): Promise<HealthKnowledgeListSnapshot<HealthKnowledgeDiseaseSummary>>;
	listSymptomsByPart(
		partId: string,
	): Promise<HealthKnowledgeListSnapshot<HealthKnowledgeLetterItem>>;
	listDiseasesBySymptoms(
		symptomIds: readonly string[],
	): Promise<HealthKnowledgeListSnapshot<HealthKnowledgeDiseaseSummary>>;
	getDiseaseDetail(
		diseaseId: string,
	): Promise<HealthKnowledgeDocument<HealthKnowledgeDiseaseDetail> | undefined>;
	getDrugDetail(
		drugId: string,
	): Promise<HealthKnowledgeDocument<HealthKnowledgeDrugDetail> | undefined>;
}
