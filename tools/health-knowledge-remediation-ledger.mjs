import { resolve } from "node:path";
import { buildHealthKnowledgeQualityFindings } from "./health-knowledge-quality-findings.mjs";

/** 默认只读取 Git 忽略的旧健康知识源快照，不访问数据库或线上服务。 */
export const DEFAULT_SOURCE_PATH =
	".local/health-knowledge/legacy-source-snapshot.json";

/**
 * 健康知识整改台账的版本。
 *
 * 台账是内容责任人和工程交接使用的脱敏工作清单，不是审核结论，也不是
 * 发布开关。版本化后，新会话可以判断字段含义是否一致，避免把旧报告和
 * 新导出混在一起。
 */
export const REMEDIATION_LEDGER_SCHEMA_VERSION = 1;

function sumFindingCounts(counts) {
	return Object.values(counts ?? {}).reduce(
		(total, value) => (typeof value === "number" ? total + value : total),
		0,
	);
}

function gate(id, label, status, issueCount, requiredAction, requiredEvidence) {
	return {
		id,
		label,
		status,
		issueCount,
		requiredAction,
		requiredEvidence,
	};
}

/**
 * 将质量定位报告转换为可执行的整改台账。
 *
 * 只保留问题类型、数量和下一步材料，不复制疾病名称、药品名称、正文或
 * 原始字段值。任何告警存在时总体状态都必须是 blocked；即使告警清零，旧
 * 源仍然是 not-approved，必须继续等待独立审核 bundle，不能由工具自动放行。
 */
export function buildHealthKnowledgeRemediationLedger(source) {
	const findings = buildHealthKnowledgeQualityFindings(source);
	const counts = findings.findingCounts;
	const sourceQualityIssueCount = sumFindingCounts({
		duplicateDiseaseDrugNames: counts.duplicateDiseaseDrugNames,
		clickableDrugReferencesWithoutId: counts.clickableDrugReferencesWithoutId,
		legacyControlCharacterOccurrences: counts.legacyControlCharacterOccurrences,
		trimmedTextFieldCount: counts.trimmedTextFieldCount,
		ignoredLegacyFieldCount: counts.ignoredLegacyFieldCount,
		ignoredLegacySourceCount: counts.ignoredLegacySourceCount,
	});
	const sourceQualityStatus =
		sourceQualityIssueCount === 0 ? "ready" : "blocked";
	const sourceApproved = findings.source.publicationState === "approved";

	const gates = [
		gate(
			"source-quality",
			"源快照质量",
			sourceQualityStatus,
			sourceQualityIssueCount,
			"处理重复关系、控制字符、清理字段和来源声明，并重新导出源快照",
			"新的源快照审计结果与质量摘要一致，且不含禁止字段",
		),
		gate(
			"clinical-review",
			"临床内容审核",
			sourceApproved ? "ready" : "blocked",
			sourceApproved ? 0 : 1,
			"由内容责任人完成逐项审核，不由工程工具推断医学正确性",
			"脱敏审核 bundle、审核责任人引用和审核时间",
		),
		gate(
			"bundle-metadata",
			"版本与发布元数据",
			"pending-input",
			1,
			"补齐 contentVersion、带时区 reviewedAt、生效窗口和固定免责声明",
			"通过 domain validator 的独立审核 bundle",
		),
		gate(
			"staging-drill",
			"staging 导入与撤回演练",
			"pending-input",
			1,
			"完成重复导入、重叠版本、查询一致性和撤回演练",
			"staging 操作记录与 fail-closed 查询证据",
		),
		gate(
			"device-acceptance",
			"真机只读验收",
			"pending-input",
			1,
			"使用同一运行包采集目录、搜索、详情和无内容状态",
			"页面结果、客户端 requestId、服务端 traceId 和内容版本",
		),
	];

	return {
		schemaVersion: REMEDIATION_LEDGER_SCHEMA_VERSION,
		publishable: false,
		status: "blocked",
		redaction: {
			valuesIncluded: false,
			message: "只包含问题类型、数量和材料要求，不包含健康知识正文或名称",
		},
		source: findings.source,
		counts: findings.counts,
		findingCounts: counts,
		gates,
		unresolvedGateCount: gates.filter((item) => item.status !== "ready").length,
		nextAction:
			sourceQualityStatus === "blocked"
				? "先按源快照质量项整改并重新导出，再提交独立临床审核 bundle"
				: "等待内容责任人提交独立审核 bundle，随后执行 staging 导入与撤回演练",
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
		const source = await Bun.file(
			resolve(process.cwd(), options.filePath),
		).json();
		console.log(
			JSON.stringify(buildHealthKnowledgeRemediationLedger(source), null, 2),
		);
	} catch (error) {
		console.error(
			error instanceof Error
				? error.message
				: "health knowledge remediation ledger failed",
		);
		process.exitCode = 1;
	}
}
