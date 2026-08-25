import { resolve } from "node:path";

/**
 * 旧健康知识快照只用于迁移审核，不是患者端 bundle。
 *
 * 这个工具只读取 JSON 并输出聚合信息，故意不打印正文、药品名称或任何
 * 可能进入快照的敏感值。默认模式检查“源快照结构是否完整”，`--strict`
 * 才会把质量告警视为失败；这样日常盘点可以看到问题，发布门禁又不会把
 * 未审核的源数据误认为可发布内容。
 */
export const DEFAULT_SOURCE_PATH =
	".local/health-knowledge/legacy-source-snapshot.json";

const REQUIRED_ARRAYS = [
	"items",
	"diseaseDetails",
	"drugDetails",
	"diseaseRelations",
	"partSymptoms",
	"symptomDiseases",
];

const QUALITY_ARRAYS = [
	"ignoredLegacyFields",
	"ignoredLegacySources",
	"duplicateDiseaseDrugNames",
	"clickableDrugReferencesWithoutId",
];

/** 这些字段一旦出现在源快照中，必须退回重新脱敏，不能进入审核队列。 */
const FORBIDDEN_KEY_PATTERNS = [
	"patientname",
	"patientid",
	"patid",
	"thirdpatientid",
	"idcard",
	"medicalcard",
	"phone",
	"mobile",
	"providerpatient",
];

function isRecord(value) {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function fail(path, message) {
	throw new Error(`${message}: ${path}`);
}

function assertRecord(value, path) {
	if (!isRecord(value)) fail(path, "expected object");
}

function assertArray(value, path) {
	if (!Array.isArray(value)) fail(path, "expected array");
}

/**
 * 只检查键名，不检查正文值；这样既能发现敏感字段误入，也不会把正文
 * 打到终端。数组索引只用于错误定位，正常输出仍然只保留计数。
 */
function findForbiddenKeys(value, path = "$", matches = []) {
	if (Array.isArray(value)) {
		value.forEach((item, index) => {
			findForbiddenKeys(item, `${path}[${index}]`, matches);
		});
		return matches;
	}
	if (!isRecord(value)) return matches;
	for (const [key, child] of Object.entries(value)) {
		const normalized = key.toLowerCase().replaceAll("_", "");
		if (
			FORBIDDEN_KEY_PATTERNS.some((pattern) => normalized.includes(pattern))
		) {
			matches.push(`${path}.${key}`);
		}
		findForbiddenKeys(child, `${path}.${key}`, matches);
	}
	return matches;
}

function countKinds(items) {
	const result = {};
	for (const item of items) {
		if (!isRecord(item) || typeof item.kind !== "string") continue;
		result[item.kind] = (result[item.kind] ?? 0) + 1;
	}
	return result;
}

/**
 * 审计已解析的旧健康知识源快照。
 *
 * `sourceValid` 只说明快照符合“未审核源数据”的结构；`publishable` 永远
 * 为 false，直到内容责任人生成并审核正式 bundle。质量告警保留为聚合值，
 * 供文档和后续人工复核使用。
 */
export function auditLegacyHealthKnowledgeSource(value, options = {}) {
	const strict = options.strict === true;
	assertRecord(value, "$root");
	if (value.schemaVersion !== 1) fail("schemaVersion", "unsupported schema");
	assertRecord(value.source, "source");
	if (value.source.system !== "legacy-hospital") {
		fail("source.system", "unexpected source system");
	}
	if (value.source.mappingVersion !== "legacy-health-knowledge-v1") {
		fail("source.mappingVersion", "unexpected mapping version");
	}
	if (value.source.publicationState !== "not-approved") {
		fail("source.publicationState", "source snapshot must remain not-approved");
	}

	for (const key of REQUIRED_ARRAYS) assertArray(value[key], key);
	assertRecord(value.quality, "quality");
	for (const key of QUALITY_ARRAYS)
		assertArray(value.quality[key], `quality.${key}`);
	for (const key of [
		"trimmedTextFieldCount",
		"defaultedInitialLetterCount",
		"legacyControlCharacterCount",
	]) {
		if (
			typeof value.quality[key] !== "number" ||
			!Number.isInteger(value.quality[key]) ||
			value.quality[key] < 0
		) {
			fail(`quality.${key}`, "expected non-negative integer");
		}
	}

	const forbiddenKeys = findForbiddenKeys(value);
	if (forbiddenKeys.length > 0) {
		fail("sensitive-fields", `forbidden keys found (${forbiddenKeys.length})`);
	}

	const qualityWarnings = {
		duplicateDiseaseDrugNames: value.quality.duplicateDiseaseDrugNames.length,
		clickableDrugReferencesWithoutId:
			value.quality.clickableDrugReferencesWithoutId.length,
		trimmedTextFieldCount: value.quality.trimmedTextFieldCount,
		defaultedInitialLetterCount: value.quality.defaultedInitialLetterCount,
		legacyControlCharacterCount: value.quality.legacyControlCharacterCount,
		ignoredLegacyFields: value.quality.ignoredLegacyFields.length,
		ignoredLegacySources: value.quality.ignoredLegacySources.length,
	};
	const hasQualityWarnings = Object.values(qualityWarnings).some(
		(count) => count > 0,
	);

	return {
		sourceValid: true,
		publishable: false,
		strictPassed: !strict || !hasQualityWarnings,
		source: {
			system: value.source.system,
			exportedAt: value.source.exportedAt,
			mappingVersion: value.source.mappingVersion,
			publicationState: value.source.publicationState,
		},
		counts: {
			items: value.items.length,
			itemsByKind: countKinds(value.items),
			diseaseDetails: value.diseaseDetails.length,
			drugDetails: value.drugDetails.length,
			diseaseRelations: value.diseaseRelations.length,
			partSymptoms: value.partSymptoms.length,
			symptomDiseases: value.symptomDiseases.length,
		},
		qualityWarnings,
	};
}

export async function auditLegacyHealthKnowledgeSourceFile(
	rootDirectory = process.cwd(),
	filePath = DEFAULT_SOURCE_PATH,
	options = {},
) {
	const absolutePath = resolve(rootDirectory, filePath);
	const value = await Bun.file(absolutePath).json();
	return auditLegacyHealthKnowledgeSource(value, options);
}

function parseArguments(argv) {
	const options = { filePath: DEFAULT_SOURCE_PATH, strict: false };
	for (let index = 0; index < argv.length; index += 1) {
		const argument = argv[index];
		if (argument === "--strict") {
			options.strict = true;
			continue;
		}
		if (argument === "--file") {
			const next = argv[index + 1];
			if (!next || next.startsWith("--")) {
				throw new Error("--file requires a path");
			}
			options.filePath = next;
			index += 1;
			continue;
		}
		throw new Error(`unknown argument: ${argument}`);
	}
	return options;
}

if (import.meta.main) {
	try {
		const options = parseArguments(process.argv.slice(2));
		const report = await auditLegacyHealthKnowledgeSourceFile(
			process.cwd(),
			options.filePath,
			options,
		);
		console.log(JSON.stringify(report, null, 2));
		if (!report.strictPassed) process.exitCode = 1;
	} catch (error) {
		console.error(
			error instanceof Error ? error.message : "health source audit failed",
		);
		process.exitCode = 1;
	}
}
