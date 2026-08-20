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

/**
 * 没有可公开的已发布版本时，患者端必须明确失败，不能回退到草稿或示例数据。
 * API 层可以将它映射为服务不可用/内容暂不可用，而不是伪装成空结果。
 */
export class HealthKnowledgeContentUnavailableError extends Error {
	constructor() {
		super("No published health knowledge content is available");
		this.name = "HealthKnowledgeContentUnavailableError";
	}
}

/**
 * 健康知识 repository 结果违反公共读模型时的低敏原因。
 *
 * TypeScript 只约束编译期调用方，不能证明 MySQL、回放实现或未来任务返回
 * 的运行时对象真的符合类型。原因固定为有限枚举，日志可以检索，但不会把
 * 疾病正文、药品字段或数据库原文写入日志和 HTTP 错误。
 */
export type HealthKnowledgeResultViolation =
	| "snapshot-not-object"
	| "document-not-object"
	| "publication-not-object"
	| "publication-invalid"
	| "items-not-array"
	| "catalog-item-invalid"
	| "catalog-item-duplicate"
	| "letter-item-invalid"
	| "letter-item-duplicate"
	| "disease-summary-invalid"
	| "disease-summary-duplicate"
	| "document-item-invalid"
	| "disease-detail-invalid"
	| "drug-reference-invalid"
	| "drug-reference-duplicate"
	| "drug-detail-invalid";

/** 健康知识读取必须整批失败，不能过滤坏行后伪装成完整内容。 */
export class HealthKnowledgeResultValidationError extends Error {
	readonly violation: HealthKnowledgeResultViolation;

	constructor(violation: HealthKnowledgeResultViolation) {
		super("Health knowledge repository result is invalid");
		this.name = "HealthKnowledgeResultValidationError";
		this.violation = violation;
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

function hasSafeKnowledgeText(
	value: unknown,
	maxLength: number,
): value is string {
	return (
		typeof value === "string" &&
		value.length > 0 &&
		value.length <= maxLength &&
		value === value.trim() &&
		!Array.from(value).some((character) => {
			const code = character.charCodeAt(0);
			return code <= 0x1f || code === 0x7f;
		})
	);
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function invalidResult(violation: HealthKnowledgeResultViolation): never {
	throw new HealthKnowledgeResultValidationError(violation);
}

function optionalKnowledgeText(
	record: Record<string, unknown>,
	field: string,
	maxLength: number,
	violation: HealthKnowledgeResultViolation,
): string | undefined {
	const value = record[field];
	if (value === undefined) return undefined;
	if (!hasSafeKnowledgeText(value, maxLength)) invalidResult(violation);
	return value;
}

function normalizePublication(value: unknown): HealthKnowledgePublication {
	if (!isRecord(value)) invalidResult("publication-not-object");
	if (
		!hasSafeKnowledgeText(value.contentVersion, 64) ||
		!hasSafeKnowledgeText(value.reviewedAt, 64) ||
		!hasSafeKnowledgeText(value.sourceLabel, 128) ||
		!hasSafeKnowledgeText(value.disclaimer, 512)
	) {
		invalidResult("publication-invalid");
	}

	const publication = {
		contentVersion: value.contentVersion,
		reviewedAt: value.reviewedAt,
		sourceLabel: value.sourceLabel,
		disclaimer: value.disclaimer,
	};
	try {
		validateHealthKnowledgePublication(publication);
	} catch {
		invalidResult("publication-invalid");
	}
	return publication;
}

function normalizeCatalogItem(value: unknown): HealthKnowledgeCatalogItem {
	if (!isRecord(value)) invalidResult("catalog-item-invalid");
	if (
		!hasSafeKnowledgeText(value.id, 128) ||
		!hasSafeKnowledgeText(value.name, 256)
	) {
		invalidResult("catalog-item-invalid");
	}
	return { id: value.id, name: value.name };
}

function normalizeLetterItem(value: unknown): HealthKnowledgeLetterItem {
	if (!isRecord(value)) invalidResult("letter-item-invalid");
	if (
		!hasSafeKnowledgeText(value.id, 128) ||
		!hasSafeKnowledgeText(value.name, 256) ||
		!hasSafeKnowledgeText(value.initialLetter, 8)
	) {
		invalidResult("letter-item-invalid");
	}
	return {
		id: value.id,
		name: value.name,
		initialLetter: value.initialLetter,
	};
}

function normalizeDiseaseSummary(
	value: unknown,
): HealthKnowledgeDiseaseSummary {
	if (!isRecord(value)) invalidResult("disease-summary-invalid");
	const letter = normalizeLetterItem(value);
	const treatmentDepartment = optionalKnowledgeText(
		value,
		"treatmentDepartment",
		500,
		"disease-summary-invalid",
	);
	const symptoms = optionalKnowledgeText(
		value,
		"symptoms",
		10_000,
		"disease-summary-invalid",
	);
	return {
		...letter,
		...(treatmentDepartment !== undefined ? { treatmentDepartment } : {}),
		...(symptoms !== undefined ? { symptoms } : {}),
	};
}

function normalizeDrugReference(value: unknown): HealthKnowledgeDrugReference {
	if (!isRecord(value)) invalidResult("drug-reference-invalid");
	const drugId = value.drugId;
	if (drugId !== undefined && !hasSafeKnowledgeText(drugId, 128)) {
		invalidResult("drug-reference-invalid");
	}
	if (
		!hasSafeKnowledgeText(value.drugName, 256) ||
		typeof value.isClickable !== "boolean" ||
		(value.isClickable && drugId === undefined)
	) {
		invalidResult("drug-reference-invalid");
	}
	return {
		...(drugId !== undefined ? { drugId } : {}),
		drugName: value.drugName,
		isClickable: value.isClickable,
	};
}

function normalizeDiseaseDetail(value: unknown): HealthKnowledgeDiseaseDetail {
	if (!isRecord(value)) invalidResult("disease-detail-invalid");
	if (
		!hasSafeKnowledgeText(value.id, 128) ||
		!hasSafeKnowledgeText(value.diseaseName, 256) ||
		!Array.isArray(value.availableDrugs)
	) {
		invalidResult("disease-detail-invalid");
	}

	const drugNames = new Set<string>();
	const availableDrugs = value.availableDrugs.map((drug) => {
		const normalized = normalizeDrugReference(drug);
		if (drugNames.has(normalized.drugName)) {
			invalidResult("drug-reference-duplicate");
		}
		drugNames.add(normalized.drugName);
		return normalized;
	});

	const optionalFields = {
		diseaseAlias: optionalKnowledgeText(
			value,
			"diseaseAlias",
			500,
			"disease-detail-invalid",
		),
		affectedPart: optionalKnowledgeText(
			value,
			"affectedPart",
			500,
			"disease-detail-invalid",
		),
		treatmentDepartment: optionalKnowledgeText(
			value,
			"treatmentDepartment",
			500,
			"disease-detail-invalid",
		),
		susceptibleCrowd: optionalKnowledgeText(
			value,
			"susceptibleCrowd",
			500,
			"disease-detail-invalid",
		),
		cause: optionalKnowledgeText(
			value,
			"cause",
			100_000,
			"disease-detail-invalid",
		),
		symptoms: optionalKnowledgeText(
			value,
			"symptoms",
			100_000,
			"disease-detail-invalid",
		),
		examination: optionalKnowledgeText(
			value,
			"examination",
			100_000,
			"disease-detail-invalid",
		),
		prevention: optionalKnowledgeText(
			value,
			"prevention",
			100_000,
			"disease-detail-invalid",
		),
		treatment: optionalKnowledgeText(
			value,
			"treatment",
			100_000,
			"disease-detail-invalid",
		),
	};

	return {
		id: value.id,
		diseaseName: value.diseaseName,
		availableDrugs,
		...Object.fromEntries(
			Object.entries(optionalFields).filter(
				([, fieldValue]) => fieldValue !== undefined,
			),
		),
	} as HealthKnowledgeDiseaseDetail;
}

function normalizeDrugDetail(value: unknown): HealthKnowledgeDrugDetail {
	if (!isRecord(value)) invalidResult("drug-detail-invalid");
	if (
		!hasSafeKnowledgeText(value.id, 128) ||
		!hasSafeKnowledgeText(value.drugName, 256)
	) {
		invalidResult("drug-detail-invalid");
	}

	const optionalFields = {
		manufacturer: optionalKnowledgeText(
			value,
			"manufacturer",
			256,
			"drug-detail-invalid",
		),
		chineseName: optionalKnowledgeText(
			value,
			"chineseName",
			256,
			"drug-detail-invalid",
		),
		specifications: optionalKnowledgeText(
			value,
			"specifications",
			256,
			"drug-detail-invalid",
		),
		treatableDiseases: optionalKnowledgeText(
			value,
			"treatableDiseases",
			500,
			"drug-detail-invalid",
		),
		indications: optionalKnowledgeText(
			value,
			"indications",
			100_000,
			"drug-detail-invalid",
		),
		usageDosage: optionalKnowledgeText(
			value,
			"usageDosage",
			100_000,
			"drug-detail-invalid",
		),
		adverseReactions: optionalKnowledgeText(
			value,
			"adverseReactions",
			100_000,
			"drug-detail-invalid",
		),
		contraindications: optionalKnowledgeText(
			value,
			"contraindications",
			100_000,
			"drug-detail-invalid",
		),
		interactions: optionalKnowledgeText(
			value,
			"interactions",
			100_000,
			"drug-detail-invalid",
		),
		precautions: optionalKnowledgeText(
			value,
			"precautions",
			100_000,
			"drug-detail-invalid",
		),
	};

	return {
		id: value.id,
		drugName: value.drugName,
		...Object.fromEntries(
			Object.entries(optionalFields).filter(
				([, fieldValue]) => fieldValue !== undefined,
			),
		),
	} as HealthKnowledgeDrugDetail;
}

function normalizeListSnapshot<T>(
	value: unknown,
	normalizeItems: (value: unknown) => T[],
): HealthKnowledgeListSnapshot<T> {
	if (!isRecord(value)) invalidResult("snapshot-not-object");
	if (!Array.isArray(value.items)) invalidResult("items-not-array");
	return {
		publication: normalizePublication(value.publication),
		items: normalizeItems(value.items),
	};
}

function normalizeDocument<T>(
	value: unknown,
	normalizeItem: (value: unknown) => T,
): HealthKnowledgeDocument<T> | undefined {
	if (value === undefined) return undefined;
	if (!isRecord(value)) invalidResult("document-not-object");
	if (value.item === undefined) invalidResult("document-item-invalid");
	return {
		publication: normalizePublication(value.publication),
		item: normalizeItem(value.item),
	};
}

/** 目录读模型整批校验后只保留患者端字段；重复 id 不能被过滤掉。 */
export function normalizeHealthKnowledgeCatalogItems(
	value: unknown,
): HealthKnowledgeCatalogItem[] {
	if (!Array.isArray(value)) invalidResult("items-not-array");
	const ids = new Set<string>();
	return value.map((item) => {
		const normalized = normalizeCatalogItem(item);
		if (ids.has(normalized.id)) invalidResult("catalog-item-duplicate");
		ids.add(normalized.id);
		return normalized;
	});
}

/** 部位/症状列表复用首字母规则，但仍需单独投影，避免 extra field 外泄。 */
export function normalizeHealthKnowledgeLetterItems(
	value: unknown,
): HealthKnowledgeLetterItem[] {
	if (!Array.isArray(value)) invalidResult("items-not-array");
	const ids = new Set<string>();
	return value.map((item) => {
		const normalized = normalizeLetterItem(item);
		if (ids.has(normalized.id)) invalidResult("letter-item-duplicate");
		ids.add(normalized.id);
		return normalized;
	});
}

/** 疾病列表整批校验，避免重复疾病让前端误判目录总数和关联关系。 */
export function normalizeHealthKnowledgeDiseaseSummaries(
	value: unknown,
): HealthKnowledgeDiseaseSummary[] {
	if (!Array.isArray(value)) invalidResult("items-not-array");
	const ids = new Set<string>();
	return value.map((item) => {
		const normalized = normalizeDiseaseSummary(item);
		if (ids.has(normalized.id)) {
			invalidResult("disease-summary-duplicate");
		}
		ids.add(normalized.id);
		return normalized;
	});
}

export function normalizeHealthKnowledgeCatalogSnapshot(
	value: unknown,
): HealthKnowledgeListSnapshot<HealthKnowledgeCatalogItem> {
	return normalizeListSnapshot(value, normalizeHealthKnowledgeCatalogItems);
}

export function normalizeHealthKnowledgeDiseaseListSnapshot(
	value: unknown,
): HealthKnowledgeListSnapshot<HealthKnowledgeDiseaseSummary> {
	return normalizeListSnapshot(value, normalizeHealthKnowledgeDiseaseSummaries);
}

export function normalizeHealthKnowledgeSymptomListSnapshot(
	value: unknown,
): HealthKnowledgeListSnapshot<HealthKnowledgeLetterItem> {
	return normalizeListSnapshot(value, normalizeHealthKnowledgeLetterItems);
}

export function normalizeHealthKnowledgeDiseaseDocument(
	value: unknown,
): HealthKnowledgeDocument<HealthKnowledgeDiseaseDetail> | undefined {
	return normalizeDocument(value, normalizeDiseaseDetail);
}

export function normalizeHealthKnowledgeDrugDocument(
	value: unknown,
): HealthKnowledgeDocument<HealthKnowledgeDrugDetail> | undefined {
	return normalizeDocument(value, normalizeDrugDetail);
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
