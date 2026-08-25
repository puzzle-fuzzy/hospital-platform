import type {
	HealthKnowledgeImportBundle,
	HealthKnowledgeImportDisease,
	HealthKnowledgeImportDiseaseRelation,
	HealthKnowledgeImportItem,
	HealthKnowledgeImportItemKind,
} from "@hospital/domain";

/**
 * 旧健康知识表的最小读取行模型。
 *
 * 这些类型只描述导出器明确 SELECT 的字段，不允许把旧表的整行对象
 * 直接塞进新端 bundle。这样旧库将来增加内部字段时，不会无意间把
 * provider、后台审计或其它未审核字段带入患者端迁移文件。
 */
export type LegacyHealthKnowledgeRows = {
	crowds: readonly LegacyCatalogRow[];
	departments: readonly LegacyCatalogRow[];
	parts: readonly LegacyCatalogRow[];
	symptoms: readonly LegacySymptomRow[];
	diseases: readonly LegacyDiseaseRow[];
	drugs: readonly LegacyDrugRow[];
	diseaseDrugs: readonly LegacyDiseaseDrugRow[];
	crowdDiseases: readonly LegacyRelationRow[];
	departmentDiseases: readonly LegacyRelationRow[];
	partDiseases: readonly LegacyRelationRow[];
	partSymptoms: readonly LegacyPartSymptomRow[];
	symptomDiseases: readonly LegacySymptomDiseaseRow[];
};

export type LegacyCatalogRow = {
	id: number;
	name: string;
};

export type LegacySymptomRow = LegacyCatalogRow & {
	initialLetter: string;
};

export type LegacyDiseaseRow = LegacyCatalogRow & {
	initialLetter: string;
	diseaseAlias: string | null;
	affectedPart: string | null;
	treatmentDepartment: string | null;
	susceptibleCrowd: string | null;
	cause: string | null;
	symptoms: string | null;
	examination: string | null;
	prevention: string | null;
	treatment: string | null;
};

export type LegacyDrugRow = LegacyCatalogRow & {
	manufacturer: string | null;
	chineseName: string | null;
	specifications: string | null;
	treatableDiseases: string | null;
	indications: string | null;
	usageDosage: string | null;
	adverseReactions: string | null;
	contraindications: string | null;
	interactions: string | null;
	precautions: string | null;
};

export type LegacyDiseaseDrugRow = {
	diseaseId: number;
	drugId: number | null;
	drugName: string;
	isClickable: number;
};

export type LegacyRelationRow = {
	relationId: number;
	diseaseId: number;
};

export type LegacyPartSymptomRow = {
	partId: number;
	symptomId: number;
};

export type LegacySymptomDiseaseRow = {
	symptomId: number;
	diseaseId: number;
};

export type HealthKnowledgeExportQuality = {
	/** 旧表中的冗余字段从未进入新 bundle，防止同一事实出现两个来源。 */
	ignoredLegacyFields: readonly string[];
	/** 旧库中存在、但当前健康知识 contract 尚未定义映射的来源表。 */
	ignoredLegacySources: readonly string[];
	/** 新导入器会拒绝这些重复关系；这里保留源行并给出可定位的低敏报告。 */
	duplicateDiseaseDrugNames: readonly {
		diseaseId: number;
		drugName: string;
		sourceDrugIds: readonly (number | null)[];
	}[];
	/** 可点击但没有旧药品主键的关系不能在新端变成可跳转药品。 */
	clickableDrugReferencesWithoutId: readonly {
		diseaseId: number;
		drugName: string;
	}[];
	/** 旧表中被清理成空值或缺省分组的字段数量，供人工复核。 */
	trimmedTextFieldCount: number;
	defaultedInitialLetterCount: number;
	/** 源快照保留的旧正文控制字符数量；正式 bundle 仍必须清理后才能校验通过。 */
	legacyControlCharacterCount: number;
};

/**
 * 迁移源快照不是患者端 bundle，也不是发布凭证。
 *
 * 它故意不包含 publication.reviewerRef/reviewedAt/status：旧表没有临床
 * 审核元数据，导出器不能伪造审核时间或把旧数据直接标成 published。只有
 * 内容责任人补齐审核信息、人工处理 quality 告警后，才允许转换成导入器
 * 接受的 draft/published bundle。
 */
export type LegacyHealthKnowledgeSourceSnapshot = {
	schemaVersion: 1;
	source: {
		system: "legacy-hospital";
		exportedAt: string;
		mappingVersion: "legacy-health-knowledge-v1";
		publicationState: "not-approved";
	};
	items: readonly HealthKnowledgeImportItem[];
	diseaseDetails: readonly HealthKnowledgeImportDisease[];
	drugDetails: readonly HealthKnowledgeImportBundle["drugDetails"][number][];
	diseaseRelations: readonly HealthKnowledgeImportDiseaseRelation[];
	partSymptoms: readonly HealthKnowledgeImportBundle["partSymptoms"][number][];
	symptomDiseases: readonly HealthKnowledgeImportBundle["symptomDiseases"][number][];
	quality: HealthKnowledgeExportQuality;
};

export class LegacyHealthKnowledgeSourceError extends Error {
	readonly path: string;

	constructor(path: string) {
		super(`Invalid legacy health knowledge source field: ${path}`);
		this.name = "LegacyHealthKnowledgeSourceError";
		this.path = path;
	}
}

function fail(path: string): never {
	throw new LegacyHealthKnowledgeSourceError(path);
}

function stableId(
	kind: HealthKnowledgeImportItemKind,
	sourceId: number,
): string {
	if (!Number.isSafeInteger(sourceId) || sourceId <= 0) {
		fail(`${kind}.id`);
	}
	return `legacy-hk-${kind}-${sourceId}`;
}

function idMap(
	kind: HealthKnowledgeImportItemKind,
	rows: readonly LegacyCatalogRow[],
): Map<number, string> {
	return new Map(rows.map((row) => [row.id, stableId(kind, row.id)]));
}

type TextOptions = {
	allowLineBreaks?: boolean;
	fieldPath: string;
	trimmed: { value: number };
	legacyControls: { value: number };
};

/**
 * 只做可审计的边界清理：去掉首尾空白，并统计不适合进入正式 bundle 的控制字符。
 *
 * 源快照的职责是保留旧数据供人工复核，所以不会静默删除 DEL 等字符；
 * 但它们会被计入质量报告，后续转换正式 bundle 时仍会被 domain validator
 * 拒绝。正文中的换行是医疗内容的一部分，因此 CR/LF 可以直接保留。
 */
function safeText(
	value: string | null,
	options: TextOptions & { required: true },
): string;
function safeText(
	value: string | null,
	options: TextOptions & { required: false },
): string | undefined;
function safeText(
	value: string | null,
	options: TextOptions & { required: boolean },
): string | undefined {
	if (value === null) {
		if (options.required) fail(options.fieldPath);
		return undefined;
	}
	if (typeof value !== "string") fail(options.fieldPath);
	const trimmed = value.trim();
	if (!trimmed) {
		if (options.required) fail(options.fieldPath);
		return undefined;
	}
	if (trimmed !== value) options.trimmed.value += 1;
	for (const character of trimmed) {
		const code = character.charCodeAt(0);
		const lineBreak = code === 0x0a || code === 0x0d;
		if (code <= 0x1f && !(options.allowLineBreaks && lineBreak)) {
			options.legacyControls.value += 1;
		}
		if (code === 0x7f) options.legacyControls.value += 1;
	}
	return trimmed;
}

function initialLetter(
	value: string | null,
	path: string,
	quality: { value: number },
	trimmed: { value: number },
	legacyControls: { value: number },
): string {
	const text = safeText(value, {
		fieldPath: path,
		required: false,
		trimmed,
		legacyControls,
	});
	if (!text) {
		quality.value += 1;
		return "#";
	}
	return text;
}

function catalogItems(
	kind: "crowd" | "department" | "part",
	rows: readonly LegacyCatalogRow[],
	trimmed: { value: number },
	legacyControls: { value: number },
): HealthKnowledgeImportItem[] {
	return rows.map((row, index) => ({
		id: stableId(kind, row.id),
		kind,
		name: safeText(row.name, {
			fieldPath: `${kind}[${index}].name`,
			required: true,
			trimmed,
			legacyControls,
		}),
	}));
}

function clickableValue(value: number, path: string): boolean {
	if (value !== 0 && value !== 1) fail(path);
	return value === 1;
}

export function mapLegacyHealthKnowledgeSource(
	rows: LegacyHealthKnowledgeRows,
	exportedAt: string,
): LegacyHealthKnowledgeSourceSnapshot {
	const trimmed = { value: 0 };
	const defaultedInitialLetter = { value: 0 };
	const legacyControls = { value: 0 };
	const crowdIds = idMap("crowd", rows.crowds);
	const departmentIds = idMap("department", rows.departments);
	const partIds = idMap("part", rows.parts);
	const symptomIds = idMap("symptom", rows.symptoms);
	const diseaseIds = idMap("disease", rows.diseases);
	const drugIds = idMap("drug", rows.drugs);

	const items: HealthKnowledgeImportItem[] = [
		...catalogItems("crowd", rows.crowds, trimmed, legacyControls),
		...catalogItems("department", rows.departments, trimmed, legacyControls),
		...catalogItems("part", rows.parts, trimmed, legacyControls),
		...rows.symptoms.map((row, index) => ({
			id: stableId("symptom", row.id),
			kind: "symptom" as const,
			name: safeText(row.name, {
				fieldPath: `symptoms[${index}].name`,
				required: true,
				trimmed,
				legacyControls,
			}),
			initialLetter: initialLetter(
				row.initialLetter,
				`symptoms[${index}].initialLetter`,
				defaultedInitialLetter,
				trimmed,
				legacyControls,
			),
		})),
		...rows.diseases.map((row, index) => ({
			id: stableId("disease", row.id),
			kind: "disease" as const,
			name: safeText(row.name, {
				fieldPath: `diseases[${index}].name`,
				required: true,
				trimmed,
				legacyControls,
			}),
			initialLetter: initialLetter(
				row.initialLetter,
				`diseases[${index}].initialLetter`,
				defaultedInitialLetter,
				trimmed,
				legacyControls,
			),
		})),
		...rows.drugs.map((row, index) => ({
			id: stableId("drug", row.id),
			kind: "drug" as const,
			name: safeText(row.name, {
				fieldPath: `drugs[${index}].name`,
				required: true,
				trimmed,
				legacyControls,
			}),
		})),
	];

	const diseaseDetails: HealthKnowledgeImportDisease[] = rows.diseases.map(
		(row, index) => {
			const optional = <K extends keyof LegacyDiseaseRow>(
				field: K,
				allowLineBreaks = false,
			): string | undefined =>
				safeText(row[field] as string | null, {
					fieldPath: `diseases[${index}].${String(field)}`,
					required: false,
					allowLineBreaks,
					trimmed,
					legacyControls,
				});
			const diseaseAlias = optional("diseaseAlias");
			const affectedPart = optional("affectedPart");
			const treatmentDepartment = optional("treatmentDepartment");
			const susceptibleCrowd = optional("susceptibleCrowd");
			const cause = optional("cause", true);
			const symptoms = optional("symptoms", true);
			const examination = optional("examination", true);
			const prevention = optional("prevention", true);
			const treatment = optional("treatment", true);
			return {
				id: stableId("disease", row.id),
				diseaseName: safeText(row.name, {
					fieldPath: `diseases[${index}].name`,
					required: true,
					trimmed,
					legacyControls,
				}),
				availableDrugs: [],
				...(diseaseAlias !== undefined ? { diseaseAlias } : {}),
				...(affectedPart !== undefined ? { affectedPart } : {}),
				...(treatmentDepartment !== undefined ? { treatmentDepartment } : {}),
				...(susceptibleCrowd !== undefined ? { susceptibleCrowd } : {}),
				...(cause !== undefined ? { cause } : {}),
				...(symptoms !== undefined ? { symptoms } : {}),
				...(examination !== undefined ? { examination } : {}),
				...(prevention !== undefined ? { prevention } : {}),
				...(treatment !== undefined ? { treatment } : {}),
			};
		},
	);

	const drugDetails: HealthKnowledgeImportBundle["drugDetails"] =
		rows.drugs.map((row, index) => {
			const optional = <K extends keyof LegacyDrugRow>(
				field: K,
				allowLineBreaks = false,
			): string | undefined =>
				safeText(row[field] as string | null, {
					fieldPath: `drugs[${index}].${String(field)}`,
					required: false,
					allowLineBreaks,
					trimmed,
					legacyControls,
				});
			const manufacturer = optional("manufacturer");
			const chineseName = optional("chineseName");
			const specifications = optional("specifications");
			const treatableDiseases = optional("treatableDiseases");
			const indications = optional("indications", true);
			const usageDosage = optional("usageDosage", true);
			const adverseReactions = optional("adverseReactions", true);
			const contraindications = optional("contraindications", true);
			const interactions = optional("interactions", true);
			const precautions = optional("precautions", true);
			return {
				id: stableId("drug", row.id),
				drugName: safeText(row.name, {
					fieldPath: `drugs[${index}].name`,
					required: true,
					trimmed,
					legacyControls,
				}),
				...(manufacturer !== undefined ? { manufacturer } : {}),
				...(chineseName !== undefined ? { chineseName } : {}),
				...(specifications !== undefined ? { specifications } : {}),
				...(treatableDiseases !== undefined ? { treatableDiseases } : {}),
				...(indications !== undefined ? { indications } : {}),
				...(usageDosage !== undefined ? { usageDosage } : {}),
				...(adverseReactions !== undefined ? { adverseReactions } : {}),
				...(contraindications !== undefined ? { contraindications } : {}),
				...(interactions !== undefined ? { interactions } : {}),
				...(precautions !== undefined ? { precautions } : {}),
			};
		});

	const diseaseDrugGroups = new Map<number, LegacyDiseaseDrugRow[]>();
	for (const row of rows.diseaseDrugs) {
		const group = diseaseDrugGroups.get(row.diseaseId) ?? [];
		group.push(row);
		diseaseDrugGroups.set(row.diseaseId, group);
	}
	const duplicateDiseaseDrugNames: Array<
		HealthKnowledgeExportQuality["duplicateDiseaseDrugNames"][number]
	> = [];
	const clickableDrugReferencesWithoutId: Array<
		HealthKnowledgeExportQuality["clickableDrugReferencesWithoutId"][number]
	> = [];
	const diseaseRowsByMappedId = new Map(
		rows.diseases.map((row) => [stableId("disease", row.id), row]),
	);
	const diseaseDetailsWithDrugs = diseaseDetails.map((detail) => {
		const sourceDisease = diseaseRowsByMappedId.get(detail.id);
		const sourceRows = sourceDisease
			? (diseaseDrugGroups.get(sourceDisease.id) ?? [])
			: [];
		const groupedNames = new Map<string, LegacyDiseaseDrugRow[]>();
		for (const row of sourceRows) {
			const group = groupedNames.get(row.drugName) ?? [];
			group.push(row);
			const isClickable = clickableValue(
				row.isClickable,
				`diseaseDrugs.${row.diseaseId}.isClickable`,
			);
			if (isClickable && row.drugId === null) {
				clickableDrugReferencesWithoutId.push({
					diseaseId: sourceDisease?.id ?? 0,
					drugName: row.drugName,
				});
			}
			groupedNames.set(row.drugName, group);
		}
		for (const [drugName, group] of groupedNames) {
			if (group.length > 1) {
				duplicateDiseaseDrugNames.push({
					diseaseId: sourceDisease?.id ?? 0,
					drugName,
					sourceDrugIds: group.map((row) => row.drugId),
				});
			}
		}
		return {
			...detail,
			availableDrugs: sourceRows.map((row) => ({
				...(row.drugId !== null
					? { drugId: drugIds.get(row.drugId) ?? stableId("drug", row.drugId) }
					: {}),
				drugName: safeText(row.drugName, {
					fieldPath: `diseaseDrugs.${row.diseaseId}.drugName`,
					required: true,
					trimmed,
					legacyControls,
				}),
				isClickable: clickableValue(
					row.isClickable,
					`diseaseDrugs.${row.diseaseId}.isClickable`,
				),
			})),
		};
	});

	const relation = (
		kind: "crowd" | "department" | "part",
		rowsForKind: readonly LegacyRelationRow[],
		ids: Map<number, string>,
	): HealthKnowledgeImportDiseaseRelation[] =>
		rowsForKind.map((row) => ({
			kind,
			relationId: ids.get(row.relationId) ?? stableId(kind, row.relationId),
			diseaseId:
				diseaseIds.get(row.diseaseId) ?? stableId("disease", row.diseaseId),
		}));

	return {
		schemaVersion: 1,
		source: {
			system: "legacy-hospital",
			exportedAt,
			mappingVersion: "legacy-health-knowledge-v1",
			publicationState: "not-approved",
		},
		items,
		diseaseDetails: diseaseDetailsWithDrugs,
		drugDetails,
		diseaseRelations: [
			...relation("crowd", rows.crowdDiseases, crowdIds),
			...relation("department", rows.departmentDiseases, departmentIds),
			...relation("part", rows.partDiseases, partIds),
		],
		partSymptoms: rows.partSymptoms.map((row) => ({
			partId: partIds.get(row.partId) ?? stableId("part", row.partId),
			symptomId:
				symptomIds.get(row.symptomId) ?? stableId("symptom", row.symptomId),
		})),
		symptomDiseases: rows.symptomDiseases.map((row) => ({
			symptomId:
				symptomIds.get(row.symptomId) ?? stableId("symptom", row.symptomId),
			diseaseId:
				diseaseIds.get(row.diseaseId) ?? stableId("disease", row.diseaseId),
		})),
		quality: {
			ignoredLegacyFields: ["knowledge_disease.available_drugs"],
			ignoredLegacySources: ["knowledge_tips"],
			duplicateDiseaseDrugNames,
			clickableDrugReferencesWithoutId,
			trimmedTextFieldCount: trimmed.value,
			defaultedInitialLetterCount: defaultedInitialLetter.value,
			legacyControlCharacterCount: legacyControls.value,
		},
	};
}
