import type {
	HealthKnowledgeCatalogKind,
	HealthKnowledgeDiseaseDetail,
	HealthKnowledgeDrugDetail,
	HealthKnowledgeDrugReference,
	HealthKnowledgePublication,
} from "./knowledge";
import {
	validateHealthKnowledgeIdentifier,
	validateHealthKnowledgeLetter,
	validateHealthKnowledgePublication,
} from "./knowledge";

/** 导入器支持草稿、发布和撤回，但患者端 repository 只读取 published。 */
export type HealthKnowledgeImportStatus = "draft" | "published" | "withdrawn";

export type HealthKnowledgeImportItemKind =
	| HealthKnowledgeCatalogKind
	| "symptom"
	| "disease"
	| "drug";

/** item 是版本内稳定的 opaque id；同一 bundle 内不得重复。 */
export type HealthKnowledgeImportItem = {
	id: string;
	kind: HealthKnowledgeImportItemKind;
	name: string;
	initialLetter?: string;
};

export type HealthKnowledgeImportPublication = HealthKnowledgePublication & {
	status: HealthKnowledgeImportStatus;
	reviewerRef?: string;
	effectiveFrom?: string;
	effectiveTo?: string;
};

export type HealthKnowledgeImportDisease = Omit<
	HealthKnowledgeDiseaseDetail,
	"availableDrugs"
> & {
	availableDrugs: readonly HealthKnowledgeDrugReference[];
};

export type HealthKnowledgeImportDiseaseRelation = {
	kind: "crowd" | "department" | "part";
	relationId: string;
	diseaseId: string;
};

export type HealthKnowledgeImportBundle = {
	publication: HealthKnowledgeImportPublication;
	items: readonly HealthKnowledgeImportItem[];
	diseaseDetails: readonly HealthKnowledgeImportDisease[];
	drugDetails: readonly HealthKnowledgeDrugDetail[];
	diseaseRelations: readonly HealthKnowledgeImportDiseaseRelation[];
	partSymptoms: readonly { partId: string; symptomId: string }[];
	symptomDiseases: readonly { symptomId: string; diseaseId: string }[];
};

export type HealthKnowledgeImportSummary = {
	contentVersion: string;
	status: HealthKnowledgeImportStatus;
	itemCount: number;
	diseaseCount: number;
	drugCount: number;
	relationCount: number;
};

/** 导入错误只返回字段路径，不把正文内容或整行数据写进错误和日志。 */
export class HealthKnowledgeImportValidationError extends Error {
	readonly path: string;

	constructor(path: string) {
		super(`Invalid health knowledge import field: ${path}`);
		this.name = "HealthKnowledgeImportValidationError";
		this.path = path;
	}
}

function fail(path: string): never {
	throw new HealthKnowledgeImportValidationError(path);
}

function asRecord(value: unknown, path: string): Record<string, unknown> {
	if (typeof value !== "object" || value === null || Array.isArray(value)) {
		fail(path);
	}
	return value as Record<string, unknown>;
}

/**
 * 导入 JSON 不允许静默丢字段。
 *
 * 内容导出如果混入患者姓名、身份证号或未来尚未纳入版本契约的字段，
 * 直接忽略会让导入人员误以为“数据完整”。这里先拒绝未知字段，再进入
 * 领域关系校验；错误只暴露字段路径，不打印字段值或正文。
 */
function assertAllowedKeys(
	record: Record<string, unknown>,
	allowedKeys: readonly string[],
	path: string,
): void {
	for (const key of Object.keys(record)) {
		if (!allowedKeys.includes(key)) fail(`${path}.${key}`);
	}
}

function requiredString(value: unknown, path: string): string {
	if (typeof value !== "string") fail(path);
	return value;
}

function optionalString(value: unknown, path: string): string | undefined {
	if (value === undefined) return undefined;
	return requiredString(value, path);
}

function requiredBoolean(value: unknown, path: string): boolean {
	if (typeof value !== "boolean") fail(path);
	return value;
}

function requiredArray(value: unknown, path: string): readonly unknown[] {
	if (!Array.isArray(value)) fail(path);
	return value;
}

function parsePublication(
	value: unknown,
	path: string,
): HealthKnowledgeImportPublication {
	const record = asRecord(value, path);
	assertAllowedKeys(
		record,
		[
			"contentVersion",
			"status",
			"reviewedAt",
			"sourceLabel",
			"disclaimer",
			"reviewerRef",
			"effectiveFrom",
			"effectiveTo",
		],
		path,
	);
	const publication: HealthKnowledgeImportPublication = {
		contentVersion: requiredString(
			record.contentVersion,
			`${path}.contentVersion`,
		),
		status: requiredString(
			record.status,
			`${path}.status`,
		) as HealthKnowledgeImportStatus,
		reviewedAt: requiredString(record.reviewedAt, `${path}.reviewedAt`),
		sourceLabel: requiredString(record.sourceLabel, `${path}.sourceLabel`),
		disclaimer: requiredString(record.disclaimer, `${path}.disclaimer`),
	};
	const reviewerRef = optionalString(record.reviewerRef, `${path}.reviewerRef`);
	const effectiveFrom = optionalString(
		record.effectiveFrom,
		`${path}.effectiveFrom`,
	);
	const effectiveTo = optionalString(record.effectiveTo, `${path}.effectiveTo`);
	if (reviewerRef !== undefined) publication.reviewerRef = reviewerRef;
	if (effectiveFrom !== undefined) publication.effectiveFrom = effectiveFrom;
	if (effectiveTo !== undefined) publication.effectiveTo = effectiveTo;
	return publication;
}

function parseItem(value: unknown, path: string): HealthKnowledgeImportItem {
	const record = asRecord(value, path);
	assertAllowedKeys(record, ["id", "kind", "name", "initialLetter"], path);
	const item: HealthKnowledgeImportItem = {
		id: requiredString(record.id, `${path}.id`),
		kind: requiredString(
			record.kind,
			`${path}.kind`,
		) as HealthKnowledgeImportItemKind,
		name: requiredString(record.name, `${path}.name`),
	};
	const initialLetter = optionalString(
		record.initialLetter,
		`${path}.initialLetter`,
	);
	if (initialLetter !== undefined) item.initialLetter = initialLetter;
	return item;
}

function parseDrugReference(
	value: unknown,
	path: string,
): HealthKnowledgeDrugReference {
	const record = asRecord(value, path);
	assertAllowedKeys(record, ["drugId", "drugName", "isClickable"], path);
	const reference: HealthKnowledgeDrugReference = {
		drugName: requiredString(record.drugName, `${path}.drugName`),
		isClickable: requiredBoolean(record.isClickable, `${path}.isClickable`),
	};
	const drugId = optionalString(record.drugId, `${path}.drugId`);
	if (drugId !== undefined) reference.drugId = drugId;
	return reference;
}

function parseDiseaseDetail(
	value: unknown,
	path: string,
): HealthKnowledgeImportDisease {
	const record = asRecord(value, path);
	assertAllowedKeys(
		record,
		[
			"id",
			"diseaseName",
			"diseaseAlias",
			"affectedPart",
			"treatmentDepartment",
			"susceptibleCrowd",
			"availableDrugs",
			"cause",
			"symptoms",
			"examination",
			"prevention",
			"treatment",
		],
		path,
	);
	const availableDrugs = requiredArray(
		record.availableDrugs,
		`${path}.availableDrugs`,
	).map((drug, index) =>
		parseDrugReference(drug, `${path}.availableDrugs[${index}]`),
	);
	const detail: HealthKnowledgeImportDisease = {
		id: requiredString(record.id, `${path}.id`),
		diseaseName: requiredString(record.diseaseName, `${path}.diseaseName`),
		availableDrugs,
	};
	const optionalFields = {
		diseaseAlias: optionalString(record.diseaseAlias, `${path}.diseaseAlias`),
		affectedPart: optionalString(record.affectedPart, `${path}.affectedPart`),
		treatmentDepartment: optionalString(
			record.treatmentDepartment,
			`${path}.treatmentDepartment`,
		),
		susceptibleCrowd: optionalString(
			record.susceptibleCrowd,
			`${path}.susceptibleCrowd`,
		),
		cause: optionalString(record.cause, `${path}.cause`),
		symptoms: optionalString(record.symptoms, `${path}.symptoms`),
		examination: optionalString(record.examination, `${path}.examination`),
		prevention: optionalString(record.prevention, `${path}.prevention`),
		treatment: optionalString(record.treatment, `${path}.treatment`),
	};
	for (const [key, value] of Object.entries(optionalFields)) {
		if (value !== undefined) {
			(detail as Record<string, unknown>)[key] = value;
		}
	}
	return detail;
}

function parseDrugDetail(
	value: unknown,
	path: string,
): HealthKnowledgeDrugDetail {
	const record = asRecord(value, path);
	assertAllowedKeys(
		record,
		[
			"id",
			"drugName",
			"manufacturer",
			"chineseName",
			"specifications",
			"treatableDiseases",
			"indications",
			"usageDosage",
			"adverseReactions",
			"contraindications",
			"interactions",
			"precautions",
		],
		path,
	);
	const detail: HealthKnowledgeDrugDetail = {
		id: requiredString(record.id, `${path}.id`),
		drugName: requiredString(record.drugName, `${path}.drugName`),
	};
	const optionalFields = {
		manufacturer: optionalString(record.manufacturer, `${path}.manufacturer`),
		chineseName: optionalString(record.chineseName, `${path}.chineseName`),
		specifications: optionalString(
			record.specifications,
			`${path}.specifications`,
		),
		treatableDiseases: optionalString(
			record.treatableDiseases,
			`${path}.treatableDiseases`,
		),
		indications: optionalString(record.indications, `${path}.indications`),
		usageDosage: optionalString(record.usageDosage, `${path}.usageDosage`),
		adverseReactions: optionalString(
			record.adverseReactions,
			`${path}.adverseReactions`,
		),
		contraindications: optionalString(
			record.contraindications,
			`${path}.contraindications`,
		),
		interactions: optionalString(record.interactions, `${path}.interactions`),
		precautions: optionalString(record.precautions, `${path}.precautions`),
	};
	for (const [key, value] of Object.entries(optionalFields)) {
		if (value !== undefined) {
			(detail as Record<string, unknown>)[key] = value;
		}
	}
	return detail;
}

function parseDiseaseRelation(
	value: unknown,
	path: string,
): HealthKnowledgeImportDiseaseRelation {
	const record = asRecord(value, path);
	assertAllowedKeys(record, ["kind", "relationId", "diseaseId"], path);
	return {
		kind: requiredString(
			record.kind,
			`${path}.kind`,
		) as HealthKnowledgeImportDiseaseRelation["kind"],
		relationId: requiredString(record.relationId, `${path}.relationId`),
		diseaseId: requiredString(record.diseaseId, `${path}.diseaseId`),
	};
}

function parsePair(
	value: unknown,
	path: string,
): { partId: string; symptomId: string } {
	const record = asRecord(value, path);
	assertAllowedKeys(record, ["partId", "symptomId"], path);
	return {
		partId: requiredString(record.partId, `${path}.partId`),
		symptomId: requiredString(record.symptomId, `${path}.symptomId`),
	};
}

function parseSymptomDisease(
	value: unknown,
	path: string,
): { symptomId: string; diseaseId: string } {
	const record = asRecord(value, path);
	assertAllowedKeys(record, ["symptomId", "diseaseId"], path);
	return {
		symptomId: requiredString(record.symptomId, `${path}.symptomId`),
		diseaseId: requiredString(record.diseaseId, `${path}.diseaseId`),
	};
}

/**
 * JSON 文件进入领域校验前，先变成明确的导入结构。
 *
 * 这一步不做任何 SQL、网络或日志副作用；它只是把运行时 unknown 解析成
 * 允许的字段集合，避免缺字段时出现普通 TypeError，也避免未知字段被静默
 * 丢弃后继续写库。
 */
function parseImportBundle(value: unknown): HealthKnowledgeImportBundle {
	const record = asRecord(value, "bundle");
	assertAllowedKeys(
		record,
		[
			"publication",
			"items",
			"diseaseDetails",
			"drugDetails",
			"diseaseRelations",
			"partSymptoms",
			"symptomDiseases",
		],
		"bundle",
	);
	return {
		publication: parsePublication(record.publication, "publication"),
		items: requiredArray(record.items, "items").map((item, index) =>
			parseItem(item, `items[${index}]`),
		),
		diseaseDetails: requiredArray(record.diseaseDetails, "diseaseDetails").map(
			(detail, index) => parseDiseaseDetail(detail, `diseaseDetails[${index}]`),
		),
		drugDetails: requiredArray(record.drugDetails, "drugDetails").map(
			(detail, index) => parseDrugDetail(detail, `drugDetails[${index}]`),
		),
		diseaseRelations: requiredArray(
			record.diseaseRelations,
			"diseaseRelations",
		).map((relation, index) =>
			parseDiseaseRelation(relation, `diseaseRelations[${index}]`),
		),
		partSymptoms: requiredArray(record.partSymptoms, "partSymptoms").map(
			(relation, index) => parsePair(relation, `partSymptoms[${index}]`),
		),
		symptomDiseases: requiredArray(
			record.symptomDiseases,
			"symptomDiseases",
		).map((relation, index) =>
			parseSymptomDisease(relation, `symptomDiseases[${index}]`),
		),
	};
}

type ImportTextOptions = {
	/** 医疗正文允许换行，导入规则必须与患者端读模型保持一致。 */
	allowLineBreaks?: boolean;
};

/**
 * 导入文本必须和读取层使用同一套控制字符边界。
 *
 * 如果导入器比读取器宽松，数据库会出现“事务已提交、患者端读不出来”
 * 的半成功版本；正文只放行 CR/LF，制表符、NUL 和其它不可见字符仍拒绝。
 */
function assertText(
	value: string,
	path: string,
	maxLength: number,
	options: ImportTextOptions = {},
): void {
	const allowLineBreaks = options.allowLineBreaks === true;
	if (
		typeof value !== "string" ||
		value.trim().length === 0 ||
		value.length > maxLength ||
		value !== value.trim() ||
		Array.from(value).some((character) => {
			const code = character.charCodeAt(0);
			const isLineBreak = code === 0x0a || code === 0x0d;
			return (
				(code <= 0x1f && !(allowLineBreaks && isLineBreak)) || code === 0x7f
			);
		})
	) {
		fail(path);
	}
}

function assertId(value: string, path: string): void {
	try {
		validateHealthKnowledgeIdentifier(value);
	} catch {
		fail(path);
	}
}

/**
 * 内容版本的时间必须携带时区。
 *
 * 如果接受 `2026-08-16T00:00:00` 这类无时区字符串，Node/Bun 会按运行环境
 * 的本地时区解释它；同一份内容在开发机、staging 和生产机上就可能得到不同的
 * `reviewed_at` 或生效窗口。导入边界因此只接受带 `Z` 或显式偏移的 RFC3339
 * 时间，避免把部署机器时区偷偷变成业务规则。
 */
function assertTimestamp(value: string | undefined, path: string): void {
	if (value === undefined) return;
	assertText(value, path, 64);
	const hasTimezone =
		/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:?\d{2})$/u.test(
			value,
		);
	if (!hasTimezone || !Number.isFinite(Date.parse(value))) fail(path);
}

function assertUnique(values: readonly string[], path: string): void {
	if (new Set(values).size !== values.length) fail(path);
}

function assertItemKind(
	items: ReadonlyMap<string, HealthKnowledgeImportItem>,
	id: string,
	kind: HealthKnowledgeImportItemKind,
	path: string,
): void {
	const item = items.get(id);
	if (!item || item.kind !== kind) fail(path);
}

function validatePublication(
	publication: HealthKnowledgeImportPublication,
): void {
	// 先保留导入器的字段级时间错误，再执行公共 publication 结构校验。
	// 如果顺序反过来，通用校验会把“不带时区”吞成笼统的 `publication`，
	// 管理端无法准确定位 bundle 的修复位置，也会让导入审计和 API 读取的
	// 错误语义不一致。
	assertTimestamp(publication.reviewedAt, "publication.reviewedAt");
	try {
		validateHealthKnowledgePublication(publication);
	} catch {
		fail("publication");
	}
	if (!["draft", "published", "withdrawn"].includes(publication.status)) {
		fail("publication.status");
	}
	if (
		(publication.status === "published" ||
			publication.status === "withdrawn") &&
		publication.reviewerRef === undefined
	) {
		fail("publication.reviewerRef");
	}
	if (
		publication.status === "published" &&
		publication.effectiveFrom === undefined
	) {
		// 已发布版本必须有明确的生效起点。否则一个误标为 published 的
		// bundle 会立即进入患者端，而且发布审计无法判断它何时开始生效。
		// effectiveTo 仍可为空，表示审核人明确允许持续生效到撤回为止。
		fail("publication.effectiveFrom");
	}
	if (publication.reviewerRef !== undefined) {
		assertText(publication.reviewerRef, "publication.reviewerRef", 128);
	}
	assertTimestamp(publication.effectiveFrom, "publication.effectiveFrom");
	assertTimestamp(publication.effectiveTo, "publication.effectiveTo");
	if (
		publication.effectiveFrom !== undefined &&
		publication.effectiveTo !== undefined &&
		Date.parse(publication.effectiveFrom) >= Date.parse(publication.effectiveTo)
	) {
		fail("publication.effectiveWindow");
	}
}

function validateItems(
	items: readonly HealthKnowledgeImportItem[],
): ReadonlyMap<string, HealthKnowledgeImportItem> {
	assertUnique(
		items.map((item) => item.id),
		"items.id",
	);
	const indexed = new Map<string, HealthKnowledgeImportItem>();
	for (const [index, item] of items.entries()) {
		const path = `items[${index}]`;
		assertId(item.id, `${path}.id`);
		assertText(item.name, `${path}.name`, 256);
		if (
			!["crowd", "department", "part", "symptom", "disease", "drug"].includes(
				item.kind,
			)
		) {
			fail(`${path}.kind`);
		}
		if (item.kind === "symptom" || item.kind === "disease") {
			try {
				validateHealthKnowledgeLetter({
					id: item.id,
					name: item.name,
					initialLetter: item.initialLetter ?? "#",
				});
			} catch {
				fail(`${path}.initialLetter`);
			}
		} else if (item.initialLetter !== undefined) {
			assertText(item.initialLetter, `${path}.initialLetter`, 8);
		}
		indexed.set(item.id, item);
	}
	return indexed;
}

function validateDiseaseDetails(
	details: readonly HealthKnowledgeImportDisease[],
	items: ReadonlyMap<string, HealthKnowledgeImportItem>,
): void {
	assertUnique(
		details.map((detail) => detail.id),
		"diseaseDetails.id",
	);
	for (const [index, detail] of details.entries()) {
		const path = `diseaseDetails[${index}]`;
		assertItemKind(items, detail.id, "disease", `${path}.id`);
		assertText(detail.diseaseName, `${path}.diseaseName`, 256);
		if (items.get(detail.id)?.name !== detail.diseaseName) {
			fail(`${path}.diseaseName`);
		}
		for (const field of [
			"diseaseAlias",
			"affectedPart",
			"treatmentDepartment",
			"susceptibleCrowd",
			"cause",
			"symptoms",
			"examination",
			"prevention",
			"treatment",
		] as const) {
			const value = detail[field];
			if (value !== undefined) {
				assertText(value, `${path}.${field}`, 100_000, {
					allowLineBreaks: true,
				});
			}
		}
		const drugNames = detail.availableDrugs.map((drug) => drug.drugName);
		assertUnique(drugNames, `${path}.availableDrugs.drugName`);
		for (const [drugIndex, drug] of detail.availableDrugs.entries()) {
			const drugPath = `${path}.availableDrugs[${drugIndex}]`;
			assertText(drug.drugName, `${drugPath}.drugName`, 256);
			if (drug.drugId !== undefined) {
				assertItemKind(items, drug.drugId, "drug", `${drugPath}.drugId`);
			}
			if (drug.isClickable && drug.drugId === undefined) {
				fail(`${drugPath}.isClickable`);
			}
		}
	}
}

function validateDrugDetails(
	details: readonly HealthKnowledgeDrugDetail[],
	items: ReadonlyMap<string, HealthKnowledgeImportItem>,
): void {
	assertUnique(
		details.map((detail) => detail.id),
		"drugDetails.id",
	);
	for (const [index, detail] of details.entries()) {
		const path = `drugDetails[${index}]`;
		assertItemKind(items, detail.id, "drug", `${path}.id`);
		assertText(detail.drugName, `${path}.drugName`, 256);
		if (items.get(detail.id)?.name !== detail.drugName) {
			fail(`${path}.drugName`);
		}
		for (const field of [
			"manufacturer",
			"chineseName",
			"specifications",
			"treatableDiseases",
			"indications",
			"usageDosage",
			"adverseReactions",
			"contraindications",
			"interactions",
			"precautions",
		] as const) {
			const value = detail[field];
			if (value !== undefined) {
				assertText(value, `${path}.${field}`, 100_000, {
					allowLineBreaks: true,
				});
			}
		}
	}
}

function validateRelations(
	bundle: HealthKnowledgeImportBundle,
	items: ReadonlyMap<string, HealthKnowledgeImportItem>,
): void {
	const relationKeys = bundle.diseaseRelations.map(
		(relation) =>
			`${relation.kind}:${relation.relationId}:${relation.diseaseId}`,
	);
	assertUnique(relationKeys, "diseaseRelations.key");
	for (const [index, relation] of bundle.diseaseRelations.entries()) {
		const path = `diseaseRelations[${index}]`;
		if (!["crowd", "department", "part"].includes(relation.kind)) {
			fail(`${path}.kind`);
		}
		assertItemKind(
			items,
			relation.relationId,
			relation.kind,
			`${path}.relationId`,
		);
		assertItemKind(items, relation.diseaseId, "disease", `${path}.diseaseId`);
	}

	const partSymptoms = bundle.partSymptoms.map(
		(relation) => `${relation.partId}:${relation.symptomId}`,
	);
	assertUnique(partSymptoms, "partSymptoms.key");
	for (const [index, relation] of bundle.partSymptoms.entries()) {
		const path = `partSymptoms[${index}]`;
		assertItemKind(items, relation.partId, "part", `${path}.partId`);
		assertItemKind(items, relation.symptomId, "symptom", `${path}.symptomId`);
	}

	const symptomDiseases = bundle.symptomDiseases.map(
		(relation) => `${relation.symptomId}:${relation.diseaseId}`,
	);
	assertUnique(symptomDiseases, "symptomDiseases.key");
	for (const [index, relation] of bundle.symptomDiseases.entries()) {
		const path = `symptomDiseases[${index}]`;
		assertItemKind(items, relation.symptomId, "symptom", `${path}.symptomId`);
		assertItemKind(items, relation.diseaseId, "disease", `${path}.diseaseId`);
	}
}

/**
 * 在任何 SQL 写入之前校验完整 bundle 的引用、版本和发布状态。
 * 该函数不判断医学正文的正确性；临床审核证据必须由导入调用方提供。
 */
function validateParsedHealthKnowledgeImportBundle(
	bundle: HealthKnowledgeImportBundle,
): HealthKnowledgeImportSummary {
	validatePublication(bundle.publication);
	const items = validateItems(bundle.items);
	validateDiseaseDetails(bundle.diseaseDetails, items);
	validateDrugDetails(bundle.drugDetails, items);
	validateRelations(bundle, items);

	const diseaseItems = bundle.items.filter((item) => item.kind === "disease");
	const drugItems = bundle.items.filter((item) => item.kind === "drug");
	if (bundle.diseaseDetails.length !== diseaseItems.length) {
		fail("diseaseDetails.completeSet");
	}
	if (bundle.drugDetails.length !== drugItems.length) {
		fail("drugDetails.completeSet");
	}

	return {
		contentVersion: bundle.publication.contentVersion,
		status: bundle.publication.status,
		itemCount: bundle.items.length,
		diseaseCount: diseaseItems.length,
		drugCount: drugItems.length,
		relationCount:
			bundle.diseaseRelations.length +
			bundle.partSymptoms.length +
			bundle.symptomDiseases.length,
	};
}

/**
 * 导入边界只接受 unknown，而不是相信调用方的 TypeScript 断言。
 *
 * 这样 CLI、后台任务和未来管理端即使直接传入 JSON，也会得到统一的字段
 * 路径错误；不会因为缺少数组而泄露普通运行时异常，更不会在校验前拿到
 * 数据库连接。医疗正文的临床正确性仍必须由审核流程负责，本函数只负责
 * 结构、版本、引用和安全字段边界。
 */
export function validateHealthKnowledgeImportBundle(
	value: unknown,
): HealthKnowledgeImportSummary {
	return validateParsedHealthKnowledgeImportBundle(parseImportBundle(value));
}
