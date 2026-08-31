import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { resolveMiniProgramSourceRevision } from "../apps/miniprogram/scripts/runtime-provenance.ts";
import {
	FROZEN_DOMAIN_GATE_CATALOG,
	MIGRATION_BATCH_IDS,
} from "./migration-boundary-catalog.mjs";
import { auditMigrationContractIntake } from "./migration-contract-intake-catalog.mjs";

const repositoryRoot = fileURLToPath(new URL("../", import.meta.url));
const miniProgramAppConfig = JSON.parse(
	await Bun.file(
		resolve(repositoryRoot, "apps/miniprogram/src/app.json"),
	).text(),
);
const { LEGACY_PAGE_MIGRATION_CATALOG } = await import(
	"../apps/miniprogram/src/services/legacy-page-catalog.ts"
);

/**
 * 当前小程序入口和页面状态必须直接来自源码事实，不允许在审计脚本里
 * 手工复制一份数字。运行来源指纹沿用构建脚本的同一套输入边界，避免
 * 文档把旧候选误标为当前 live 运行输入。
 */
const miniProgramPageCount = miniProgramAppConfig.pages.length;
const legacyPageStatusCounts = Object.groupBy(
	LEGACY_PAGE_MIGRATION_CATALOG,
	(entry) => entry.status,
);
const miniProgramSourceRevision = resolveMiniProgramSourceRevision(
	repositoryRoot,
	undefined,
	"HOSPITAL_MINIPROGRAM_SOURCE_REVISION",
);

function formatLegacyPageStatus(status) {
	return `${status}=${legacyPageStatusCounts[status]?.length ?? 0}`;
}

/**
 * 统计准入目录的机器事实，避免手工文档把“计划能力”写成“已暴露入口”。
 *
 * 这里故意不读取 pending 运行包、旧服务或数据库：文档事实审计必须能在
 * 干净 checkout 和 CI 中稳定运行；运行包来源另由 readiness/release 门禁负责。
 */
function buildBoundaryFacts() {
	const batchCoverage = new Map(
		MIGRATION_BATCH_IDS.map((batchId) => [
			batchId,
			{ gateCount: 0, legacyEntryCount: 0, legacyActionCount: 0 },
		]),
	);
	for (const gate of FROZEN_DOMAIN_GATE_CATALOG) {
		const batch = batchCoverage.get(gate.migrationBatch);
		if (!batch) continue;
		batch.gateCount += 1;
		batch.legacyEntryCount += gate.legacyPaths.length;
		batch.legacyActionCount += gate.legacyActions?.length ?? 0;
	}
	return {
		frozenGateCount: FROZEN_DOMAIN_GATE_CATALOG.length,
		batchCoverage,
		contractIntake: auditMigrationContractIntake(),
	};
}

function requiredDocumentFragments(facts) {
	const batch = (batchId) => facts.batchCoverage.get(batchId);
	const formatBatch = (batchId) => {
		const value = batch(batchId);
		return `${value.gateCount}/${value.legacyEntryCount}/${value.legacyActionCount}`;
	};
	return [
		{
			path: "docs/migration/migration-readiness-report.md",
			fragments: [
				`${facts.frozenGateCount} 个冻结入口 gate`,
				`A \`${formatBatch("A-readonly-evidence")}\``,
				`D \`${formatBatch("D-patient-and-convenience-write")}\``,
				`覆盖 ${facts.contractIntake.coveredFeatureKeyCount} 个已暴露 FeatureKey`,
			],
		},
		{
			path: "docs/migration/contract-intake-catalog-2026-08-25.md",
			fragments: [
				`${facts.contractIntake.featureIntakeRows.length} 个已暴露入口逐条展开`,
				`| D：患者与便民写入 | ${batch("D-patient-and-convenience-write").gateCount} |`,
				`${facts.contractIntake.coveredFeatureKeyCount} 个已暴露 FeatureKey 全部覆盖`,
				"`patient-address` 尚未暴露旧页面或 action",
			],
		},
		{
			path: "docs/migration/breadth-first-migration-plan-2026-08-25.md",
			fragments: [
				`A=${batch("A-readonly-evidence").gateCount}`,
				`D=${batch("D-patient-and-convenience-write").gateCount}`,
				"`patient-address` 尚未暴露旧页面或 action",
			],
		},
		{
			path: "docs/migration/current-breadth-audit-2026-08-26.md",
			fragments: [
				`${facts.contractIntake.coveredFeatureKeyCount} 个已暴露 FeatureKey 全部覆盖`,
				"12 个计划能力共用的命令状态基础",
				"当前只有 11 个进入冻结入口",
			],
		},
		{
			// 这份页面覆盖证据保留了历史候选段落，顶部的当前事实必须
			// 与机器台账和运行来源同步；否则新会话很容易拿过期运行包
			// 继续生成真机证据。这里只校验低敏版本、页数和状态计数，
			// 不读取 dist 内容。
			path: "docs/release/breadth-first-page-coverage-2026-08-25.md",
			fragments: [
				`64 个旧页面、${miniProgramPageCount} 个原生页面`,
				formatLegacyPageStatus("partial"),
				formatLegacyPageStatus("surface-only"),
				formatLegacyPageStatus("blocked-provider"),
				formatLegacyPageStatus("blocked-external"),
				`当前小程序源码与 live 运行输入为 \`${miniProgramSourceRevision}\``,
			],
		},
	];
}

/** 审计当前事实源文档；只输出缺失片段，不回显文档正文或敏感内容。 */
export async function auditMigrationDocumentation(root = repositoryRoot) {
	const facts = buildBoundaryFacts();
	const failures = [];
	for (const document of requiredDocumentFragments(facts)) {
		const content = await Bun.file(resolve(root, document.path)).text();
		for (const fragment of document.fragments) {
			if (!content.includes(fragment)) {
				failures.push(`${document.path} 缺少当前事实：${fragment}`);
			}
		}
	}
	return {
		frozenGateCount: facts.frozenGateCount,
		contractFeatureKeyCount: facts.contractIntake.coveredFeatureKeyCount,
		failures,
		passed: failures.length === 0,
	};
}

if (import.meta.main) {
	const report = await auditMigrationDocumentation();
	console.log(JSON.stringify(report, null, 2));
	if (!report.passed) process.exitCode = 1;
}
