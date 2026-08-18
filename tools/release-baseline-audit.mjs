import { readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const repositoryRoot = resolve(scriptDirectory, "..");

/**
 * 当前候选文档是发布基线的唯一人工入口；其他“当前状态”文档必须引用同一
 * 服务端 release 和小程序来源指纹。历史发布记录可以保留旧 hash，但不能再
 * 被当前路线图、迁移清单或业务验收审计当作线上版本。
 */
export const currentBaselineDocuments = Object.freeze([
	{ path: "docs/README.md", label: "文档导航" },
	{ path: "docs/wechat-auth-login.md", label: "微信授权登录手册" },
	{
		path: "docs/release/miniprogram-readonly-acceptance-candidate-2026-08-18.md",
		label: "小程序只读业务验收候选",
	},
	{ path: "docs/roadmap-next-phase.md", label: "下一阶段实施路线图" },
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
		path: "docs/migration/remaining-migration-inventory.md",
		label: "剩余迁移清单",
	},
	{
		path: "docs/release/p0-readonly-business-acceptance-runbook-2026-08-17.md",
		label: "P0 只读业务验收手册",
	},
	{
		path: "docs/release/miniprogram-device-session-boundary-2026-08-18.md",
		label: "小程序真机调试会话边界",
	},
	{
		path: "docs/release/1b94c46-production-acceptance-2026-08-18.md",
		label: "当前服务端生产切换证据",
	},
	{
		path: "docs/release/readonly-business-contract-audit-2026-08-18.md",
		label: "只读业务 contract 审计",
	},
	{
		path: "docs/release/report-readonly-contract-audit-2026-08-18.md",
		label: "报告只读 contract 审计",
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
		"docs/release/miniprogram-readonly-acceptance-candidate-2026-08-18.md",
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
