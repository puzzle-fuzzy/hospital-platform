import { readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const repositoryRoot = resolve(scriptDirectory, "..");

/**
 * 当前候选文档是发布基线的唯一人工入口；只有明确标记为当前入口的少量文档
 * 才需要引用同一服务端 release 和小程序来源指纹。历史发布记录可以保留旧
 * hash，不能因为它们曾经写过“当前”就被重新解释成这次真机验收版本。
 */
export const currentBaselineDocuments = Object.freeze([
	{ path: "docs/README.md", label: "文档导航" },
	{ path: "docs/wechat-auth-login.md", label: "微信授权登录手册" },
	{
		path: "docs/release/candidate-474b044-local-build-2026-08-19.md",
		label: "当前小程序本地构建候选",
	},
	{ path: "docs/roadmap-next-phase.md", label: "下一阶段实施路线图" },
	{
		path: "docs/migration/remaining-migration-inventory.md",
		label: "剩余迁移清单",
	},
	{
		path: "docs/release/miniprogram-real-device-acceptance-checklist-2026-08-19.md",
		label: "当前小程序真机验收清单",
	},
	{
		path: "docs/release/p0-readonly-business-acceptance-runbook-2026-08-17.md",
		label: "P0 只读业务验收手册",
	},
	{
		path: "docs/release/user-profile-readonly-device-acceptance-2026-08-18.md",
		label: "普通资料验收手册",
	},
	{
		path: "docs/release/readonly-business-contract-audit-2026-08-18.md",
		label: "P0 只读业务 contract 审计",
	},
	{
		path: "docs/migration/current-execution-checkpoint-2026-08-17.md",
		label: "当前迁移执行检查点",
	},
	{
		path: "docs/migration/migration-gap-audit-2026-08-17.md",
		label: "迁移差距审计",
	},
	{
		path: "docs/migration/patient-sync-idempotency-contract.md",
		label: "患者同步幂等契约",
	},
	{
		path: "docs/migration/outpatient-payment-provider-contract-audit-2026-08-19.md",
		label: "门诊费用 Provider 契约审计",
	},
	{
		path: "docs/release/appointment-record-tab-contract-audit-2026-08-19.md",
		label: "预约记录标签契约审计",
	},
	{
		path: "docs/release/report-readonly-contract-audit-2026-08-18.md",
		label: "报告只读契约审计",
	},
]);

/** 从验收候选的表格中提取当前服务端和小程序来源指纹。 */
export function extractCurrentBaseline(candidateDocument) {
	const serverRelease = candidateDocument.match(
		/^\| 服务端 release \| `([0-9a-f]{7,40})` \|/mu,
	)?.[1];
	const miniProgramCommit = candidateDocument.match(
		/^\| 小程序客户端 \| `([0-9a-f]{7,40})` \|/mu,
	)?.[1];
	const miniProgramSourceRevision = candidateDocument.match(
		/^\| 小程序构建来源 \| `([0-9a-f]{40})` \|/mu,
	)?.[1];

	if (!serverRelease || !miniProgramCommit || !miniProgramSourceRevision) {
		throw new Error(
			"当前候选文档缺少可解析的服务端 release、小程序提交或完整 sourceRevision",
		);
	}
	if (!miniProgramSourceRevision.startsWith(miniProgramCommit)) {
		throw new Error("小程序 sourceRevision 不是候选文档声明的小程序提交前缀");
	}

	return { serverRelease, miniProgramCommit, miniProgramSourceRevision };
}

/**
 * 从路线图中提取“当前立即执行项”正文。
 *
 * 路线图同时保留了大量历史发布记录；如果只用全文搜索当前 hash，旧
 * release 也可能让审计通过，下一次真机验收就有拿错运行包的风险。当前
 * 执行项必须和历史追溯段有明确标题边界，不能让历史文字混入当前指令。
 */
export function extractCurrentExecutionSection(roadmapDocument) {
	const currentHeader = "## 本次立即执行项";
	const historyHeader = "### 历史补充（仅供追溯，不作为当前执行项）";
	const currentStart = roadmapDocument.indexOf(currentHeader);
	if (currentStart < 0) return undefined;
	const sectionStart = currentStart + currentHeader.length;
	const historyStart = roadmapDocument.indexOf(historyHeader, sectionStart);
	if (historyStart < 0) return undefined;
	return roadmapDocument.slice(sectionStart, historyStart);
}

/**
 * 当前路线图的执行指令必须锁定同一套候选来源。
 * 只返回固定的文档错误，不回显 token、患者信息或 Provider 原文。
 */
export function auditCurrentExecutionSection(baseline, roadmapDocument) {
	const section = extractCurrentExecutionSection(roadmapDocument);
	if (!section) {
		return ["下一阶段实施路线图缺少当前执行项与历史追溯段的明确边界"];
	}

	const failures = [];
	if (!section.includes(baseline.serverRelease)) {
		failures.push(`当前执行项缺少当前服务端 release ${baseline.serverRelease}`);
	}
	if (!section.includes(baseline.miniProgramCommit)) {
		failures.push(`当前执行项缺少小程序提交 ${baseline.miniProgramCommit}`);
	}
	if (!section.includes(baseline.miniProgramSourceRevision)) {
		failures.push(
			`当前执行项缺少完整小程序 sourceRevision ${baseline.miniProgramSourceRevision}`,
		);
	}
	return failures;
}

/**
 * 检查一组文档是否都写明同一套当前候选。
 * 返回低敏失败信息，便于本地门禁和测试复用，不输出 token、患者或 Provider 内容。
 */
export function auditCurrentBaselineDocuments(baseline, documents) {
	const failures = [];
	for (const document of documents) {
		if (!document.content.includes(baseline.serverRelease)) {
			failures.push(
				`${document.label} 缺少当前服务端 release ${baseline.serverRelease}`,
			);
		}
		if (!document.content.includes(baseline.miniProgramSourceRevision)) {
			failures.push(
				`${document.label} 缺少完整小程序 sourceRevision ${baseline.miniProgramSourceRevision}`,
			);
		}
	}
	const roadmap = documents.find(
		(document) => document.label === "下一阶段实施路线图",
	);
	if (roadmap) {
		failures.push(...auditCurrentExecutionSection(baseline, roadmap.content));
	}
	return {
		passed: failures.length === 0,
		serverRelease: baseline.serverRelease,
		miniProgramCommit: baseline.miniProgramCommit,
		miniProgramSourceRevision: baseline.miniProgramSourceRevision,
		failures,
	};
}

/** 读取当前仓库文档并执行发布基线一致性审计。 */
export async function auditCurrentReleaseConsistency(
	rootDirectory = repositoryRoot,
) {
	const candidatePath = join(
		rootDirectory,
		"docs/release/candidate-474b044-local-build-2026-08-19.md",
	);
	const candidateDocument = await readFile(candidatePath, "utf8");
	const baseline = extractCurrentBaseline(candidateDocument);
	const documents = [];

	for (const document of currentBaselineDocuments) {
		const content = await readFile(join(rootDirectory, document.path), "utf8");
		documents.push({ ...document, content });
	}

	return auditCurrentBaselineDocuments(baseline, documents);
}

if (import.meta.main) {
	try {
		const result = await auditCurrentReleaseConsistency();
		console.log(JSON.stringify(result, null, 2));
		if (!result.passed) process.exitCode = 1;
	} catch (error) {
		console.error(
			`当前发布基线审计失败：${error instanceof Error ? error.message : "未知错误"}`,
		);
		process.exitCode = 2;
	}
}
