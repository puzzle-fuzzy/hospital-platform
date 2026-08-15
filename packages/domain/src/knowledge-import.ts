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

function assertText(value: string, path: string, maxLength: number): void {
	if (
		typeof value !== "string" ||
		value.trim().length === 0 ||
		value.length > maxLength
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

function assertDate(value: string | undefined, path: string): void {
	if (value !== undefined && !Number.isFinite(Date.parse(value))) fail(path);
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
	if (publication.reviewerRef !== undefined) {
		assertText(publication.reviewerRef, "publication.reviewerRef", 128);
	}
	assertDate(publication.effectiveFrom, "publication.effectiveFrom");
	assertDate(publication.effectiveTo, "publication.effectiveTo");
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
			if (value !== undefined) assertText(value, `${path}.${field}`, 100_000);
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
			if (value !== undefined) assertText(value, `${path}.${field}`, 100_000);
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
export function validateHealthKnowledgeImportBundle(
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
