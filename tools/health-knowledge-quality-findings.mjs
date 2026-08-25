import { resolve } from "node:path";
import { auditLegacyHealthKnowledgeSource } from "./health-knowledge-source-audit.mjs";

/** 默认只读取 Git 忽略的旧健康知识源快照，不读取数据库或线上服务。 */
export const DEFAULT_SOURCE_PATH =
	".local/health-knowledge/legacy-source-snapshot.json";

/**
 * 健康知识质量定位结果的版本。
 *
 * 结果只保留 JSON 路径、数组索引和计数，不保留疾病名、药品名、正文或
 * 任何原始字段值。路径用于内容责任人在本机私有快照中定位问题，不能
 * 被误当成审核结论，也不能绕过正式 bundle validator。
 */
export const QUALITY_FINDINGS_SCHEMA_VERSION = 1;

function isRecord(value) {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function controlCharacterCount(value) {
	if (typeof value !== "string") return 0;
	let count = 0;
	for (const character of value) {
		const code = character.charCodeAt(0);
		if ((code <= 0x1f && code !== 0x0a && code !== 0x0d) || code === 0x7f) {
			count += 1;
		}
	}
	return count;
}

/** 只输出含控制字符的字段路径和出现次数，不输出字段内容。 */
function collectControlCharacterFindings(value, path = "$", findings = []) {
	if (typeof value === "string") {
		const count = controlCharacterCount(value);
		if (count > 0) findings.push({ path, count });
		return findings;
	}
	if (Array.isArray(value)) {
		value.forEach((item, index) => {
			collectControlCharacterFindings(item, `${path}[${index}]`, findings);
		});
		return findings;
	}
	if (!isRecord(value)) return findings;
	for (const [key, child] of Object.entries(value)) {
		collectControlCharacterFindings(child, `${path}.${key}`, findings);
	}
	return findings;
}

/**
 * 返回重复药品关系所在的疾病详情下标和关系下标。
 *
 * 名称只在进程内用于分组，结果绝不返回名称；重复关系必须由内容责任人
 * 判断是同药多来源、重复导入还是需要合并，工程工具不能自动选择。
 */
function collectDuplicateDrugFindings(source) {
	const findings = [];
	for (const [detailIndex, detail] of (source.diseaseDetails ?? []).entries()) {
		if (!isRecord(detail) || !Array.isArray(detail.availableDrugs)) continue;
		const indexesByName = new Map();
		for (const [referenceIndex, reference] of detail.availableDrugs.entries()) {
			if (!isRecord(reference) || typeof reference.drugName !== "string") {
				continue;
			}
			const indexes = indexesByName.get(reference.drugName) ?? [];
			indexes.push(referenceIndex);
			indexesByName.set(reference.drugName, indexes);
		}
		for (const referenceIndexes of indexesByName.values()) {
			if (referenceIndexes.length > 1) {
				findings.push({ detailIndex, referenceIndexes });
			}
		}
	}
	return findings;
}

/** 输出缺少 opaque drugId 的可点击关系位置，不输出药品名称。 */
function collectDanglingDrugFindings(source) {
	const findings = [];
	for (const [detailIndex, detail] of (source.diseaseDetails ?? []).entries()) {
		if (!isRecord(detail) || !Array.isArray(detail.availableDrugs)) continue;
		for (const [referenceIndex, reference] of detail.availableDrugs.entries()) {
			if (
				isRecord(reference) &&
				reference.isClickable === true &&
				!Object.hasOwn(reference, "drugId")
			) {
				findings.push({ detailIndex, referenceIndex });
			}
		}
	}
	return findings;
}

/**
 * 生成可交给内容责任人的定位报告。
 *
 * 先复用源快照审计，确保报告与质量摘要、敏感字段门禁使用同一套规则；
 * 审计失败时直接抛错，不生成“看起来完整”的部分报告。
 */
export function buildHealthKnowledgeQualityFindings(source) {
	const sourceAudit = auditLegacyHealthKnowledgeSource(source);
	const duplicateDiseaseDrugNames = collectDuplicateDrugFindings(source);
	const clickableDrugReferencesWithoutId = collectDanglingDrugFindings(source);
	const legacyControlCharacters = [
		collectControlCharacterFindings(source.items, "$.items"),
		collectControlCharacterFindings(source.diseaseDetails, "$.diseaseDetails"),
		collectControlCharacterFindings(source.drugDetails, "$.drugDetails"),
	].flat();

	return {
		schemaVersion: QUALITY_FINDINGS_SCHEMA_VERSION,
		redaction: {
			valuesIncluded: false,
			message: "仅包含 JSON 路径、数组索引和数量，不包含健康知识正文或名称",
		},
		source: sourceAudit.source,
		counts: sourceAudit.counts,
		findingCounts: {
			duplicateDiseaseDrugNames: duplicateDiseaseDrugNames.length,
			clickableDrugReferencesWithoutId: clickableDrugReferencesWithoutId.length,
			legacyControlCharacterOccurrences: legacyControlCharacters.reduce(
				(total, finding) => total + finding.count,
				0,
			),
			legacyControlCharacterFields: legacyControlCharacters.length,
			trimmedTextFieldCount: sourceAudit.qualityWarnings.trimmedTextFieldCount,
			ignoredLegacyFieldCount: sourceAudit.qualityWarnings.ignoredLegacyFields,
			ignoredLegacySourceCount:
				sourceAudit.qualityWarnings.ignoredLegacySources,
		},
		findings: {
			duplicateDiseaseDrugNames,
			clickableDrugReferencesWithoutId,
			legacyControlCharacters,
			trimmedTextFields: {
				count: sourceAudit.qualityWarnings.trimmedTextFieldCount,
				locationsAvailable: false,
				reason: "旧导出只保留聚合计数，需内容责任人重新导出后定位",
			},
		},
	};
}

function parseArguments(argv) {
	const options = { filePath: DEFAULT_SOURCE_PATH };
	for (let index = 0; index < argv.length; index += 1) {
		const argument = argv[index];
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
		const absolutePath = resolve(process.cwd(), options.filePath);
		const source = await Bun.file(absolutePath).json();
		console.log(
			JSON.stringify(buildHealthKnowledgeQualityFindings(source), null, 2),
		);
	} catch (error) {
		console.error(
			error instanceof Error
				? error.message
				: "health knowledge quality findings failed",
		);
		process.exitCode = 1;
	}
}
