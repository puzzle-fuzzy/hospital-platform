import { expect, test } from "bun:test";
import {
	auditCurrentBaselineDocuments,
	auditCurrentCandidateRuleRegistration,
	auditCurrentCandidateReferences,
	auditCurrentExecutionSection,
	auditCurrentReadonlyBusinessBoundaries,
	auditCurrentReleaseConsistency,
	auditCurrentSourceRevisionAnnouncements,
	auditServerRuntimeSourceChanges,
	auditServerSourceRelease,
	extractCurrentBaseline,
} from "./release-baseline-audit.mjs";

test("当前候选语义规则必须注册到当前基线文档集合", () => {
	expect(auditCurrentCandidateRuleRegistration()).toEqual([]);
	expect(auditCurrentCandidateRuleRegistration(["docs/README.md"])).toContain(
		"当前候选引用规则未注册到基线文档集合：docs/release/current-project-baseline-2026-08-27.md",
	);
});

test("当前日期的运行包来源声明不能漂移到历史候选", () => {
	const baseline = {
		miniProgramSourceRevision: "4c9cfb4b1e4632a25e3e03ae4288d74ed845df3d",
	};
	const failures = auditCurrentSourceRevisionAnnouncements(baseline, [
		{
			label: "当前验收手册",
			content: [
				"> 当前配套小程序运行包来源（2026-08-27）：`old-candidate`",
				"> 当前小程序配套运行包来源（2026-08-27）：`4c9cfb4b1e4632a25e3e03ae4288d74ed845df3d`",
				"> 当前统一发布基线补充（2026-08-27）：小程序本地 live 运行包来源为 `old-candidate`",
			].join("\n"),
		},
	]);

	expect(failures).toEqual([
		"当前验收手册 的“当前配套小程序运行包来源（2026-08-27）”未指向当前完整小程序 sourceRevision",
		"当前验收手册 的“当前统一发布基线补充（2026-08-27）”未指向当前完整小程序 sourceRevision",
	]);
});

test("从候选文档提取服务端和小程序来源基线", () => {
	const baseline = extractCurrentBaseline(`
| 服务端 release | \`1b94c46\` |
| 小程序客户端 | \`4c9cfb4\` |
| 小程序构建来源 | \`4c9cfb4b1e4632a25e3e03ae4288d74ed845df3d\` |
`);

	expect(baseline).toEqual({
		serverRelease: "1b94c46",
		miniProgramCommit: "4c9cfb4",
		miniProgramSourceRevision: "4c9cfb4b1e4632a25e3e03ae4288d74ed845df3d",
	});
});

test("小程序完整来源指纹不属于候选提交时拒绝基线", () => {
	expect(() =>
		extractCurrentBaseline(`
| 服务端 release | \`1b94c46\` |
| 小程序客户端 | \`4c9cfb4\` |
| 小程序构建来源 | \`86fa75f3a76718dcf8da96fc6c10f71e5a4b49a2\` |
`),
	).toThrow("不是候选文档声明的小程序提交前缀");
});

test("文档缺少当前来源指纹时不能通过基线审计", () => {
	const result = auditCurrentBaselineDocuments(
		{
			serverRelease: "1b94c46",
			miniProgramCommit: "4c9cfb4",
			miniProgramSourceRevision: "4c9cfb4b1e4632a25e3e03ae4288d74ed845df3d",
		},
		[
			{
				label: "旧审计",
				content: "当前服务端是 4ae2a31，未记录小程序构建来源。",
			},
		],
	);

	expect(result.passed).toBe(false);
	expect(result.failures).toEqual([
		"旧审计 缺少当前服务端 release 1b94c46",
		"旧审计 缺少完整小程序 sourceRevision 4c9cfb4b1e4632a25e3e03ae4288d74ed845df3d",
	]);
});

test("路线图当前执行项必须与历史发布记录分界并锁定完整来源", () => {
	const baseline = {
		serverRelease: "1b94c46",
		miniProgramCommit: "4c9cfb4",
		miniProgramSourceRevision: "4c9cfb4b1e4632a25e3e03ae4288d74ed845df3d",
	};
	const roadmap = `
## 本次立即执行项

1. 使用服务端 release \`1b94c46\` 和小程序候选 \`4c9cfb4\`。
2. 构建来源为 \`4c9cfb4b1e4632a25e3e03ae4288d74ed845df3d\`。

### 历史补充（仅供追溯，不作为当前执行项）

旧 release \`d177991\`。
`;

	expect(auditCurrentExecutionSection(baseline, roadmap)).toEqual([]);
});

test("路线图缺少完整小程序来源时拒绝执行项", () => {
	const baseline = {
		serverRelease: "1b94c46",
		miniProgramCommit: "4c9cfb4",
		miniProgramSourceRevision: "4c9cfb4b1e4632a25e3e03ae4288d74ed845df3d",
	};
	const failures = auditCurrentExecutionSection(
		baseline,
		"## 本次立即执行项\n使用 1b94c46 和 4c9cfb4。\n### 历史补充（仅供追溯，不作为当前执行项）",
	);

	expect(failures).toEqual([
		"当前执行项缺少完整小程序 sourceRevision 4c9cfb4b1e4632a25e3e03ae4288d74ed845df3d",
	]);
});

test("报告关闭门禁必须在路线图和 P0 手册中保持 fail-closed", () => {
	const roadmap = `
## 本次立即执行项

1. 真机验收报告目录，直到报告 Provider contract 开放；报告目录当前只验证 fail-closed 文案、HTTP 边界和日志边界，不进行真实报告数据验收。

### 历史补充（仅供追溯，不作为当前执行项）
`;
	const runbook = `
ZHONGYANG_REPORT_DIRECTORY_READY=false
ZHONGYANG_REPORT_DETAIL_READY=false
当前只允许验收 fail-closed 文案。
`;

	expect(auditCurrentReadonlyBusinessBoundaries(roadmap, runbook)).toEqual([]);
});

test("报告文档把关闭门禁写成真实成功时拒绝发布基线", () => {
	const roadmap = `
## 本次立即执行项

1. 真机验收报告目录真实数据。

### 历史补充（仅供追溯，不作为当前执行项）
`;
	const runbook = "报告目录可用。";

	expect(auditCurrentReadonlyBusinessBoundaries(roadmap, runbook)).toEqual([
		"报告目录当前执行项缺少 fail-closed 关闭边界",
		"报告目录当前执行项缺少 Provider contract 开放前置条件",
		"报告目录当前执行项未明确禁止真实报告数据验收",
		"P0 手册缺少报告关闭边界：ZHONGYANG_REPORT_DIRECTORY_READY=false",
		"P0 手册缺少报告关闭边界：ZHONGYANG_REPORT_DETAIL_READY=false",
		"P0 手册缺少报告关闭边界：只允许验收 fail-closed",
	]);
});

test("当前语义短语附近的历史候选会被发布基线拒绝", () => {
	const baseline = {
		serverRelease: "1b94c46",
		miniProgramCommit: "4c9cfb4",
		miniProgramSourceRevision: "4c9cfb4b1e4632a25e3e03ae4288d74ed845df3d",
	};
	const documents = [
		{
			path: "docs/release/readonly-business-contract-audit-2026-08-18.md",
			content: `## 1. 证据范围与当前发布边界\n当前配套候选为 \`${baseline.miniProgramSourceRevision}\`。\n## 2. 已验证的不变量\n## 3. 当前工作树测试证据\n当前真机候选以 \`old-candidate\` 为准。\n## 4. 尚未完成的证据与停止条件`,
		},
		{
			path: "docs/migration/migration-gap-audit-2026-08-17.md",
			content: `## 2. 当前事实\n配套小程序构建来源为 \`${baseline.miniProgramSourceRevision}\`。\n## 3. 下一步`,
		},
		{
			path: "docs/release/report-readonly-contract-audit-2026-08-18.md",
			content: `## 0. 当前检查点\n配套小程序构建来源为 \`${baseline.miniProgramSourceRevision}\`。\n## 1. 当前链路\n配套小程序构建来源为 \`old-report-candidate\`。\n## 2. 已验证`,
		},
	];

	expect(auditCurrentCandidateReferences(baseline, documents)).toEqual([
		"P0 只读业务 contract 审计 的“当前真机候选以”未指向当前完整小程序 sourceRevision",
		"报告只读契约审计 的“配套小程序构建来源为”未指向当前完整小程序 sourceRevision",
	]);
});

test("业务门禁执行板的当前候选不能漂移到历史小程序包", () => {
	const baseline = {
		serverRelease: "1b94c46",
		miniProgramCommit: "4c9cfb4",
		miniProgramSourceRevision: "4c9cfb4b1e4632a25e3e03ae4288d74ed845df3d",
	};
	const documents = [
		{
			path: "docs/release/next-business-gates-2026-08-20.md",
			content: `## 2026-08-21 当前候选只读业务复核
当前验收基线为服务端 \`old-server\`、小程序候选 \`old-candidate\`；
## 1. 当前门禁状态`,
		},
	];

	expect(auditCurrentCandidateReferences(baseline, documents)).toEqual([
		"下一阶段业务门禁执行板 的“当前验收基线为服务端”未指向当前服务端 release",
		"下一阶段业务门禁执行板 的“当前验收基线为服务端”未指向当前完整小程序 sourceRevision",
	]);
});

test("只读业务不变量审计的当前章节不能漂移到历史候选", () => {
	const baseline = {
		serverRelease: "1b94c46",
		miniProgramCommit: "4c9cfb4",
		miniProgramSourceRevision: "4c9cfb4b1e4632a25e3e03ae4288d74ed845df3d",
	};
	const documents = [
		{
			path: "docs/release/readonly-business-invariant-review-2026-08-22.md",
			content: `
## 1. 当前版本与运行边界
小程序运行包来源：\`old-candidate\`。
## 2. 业务不变量审计结论
## 3. 本轮验证证据
发布基线指向服务端 \`old-server\` 和小程序 \`old-candidate\`。
### 2026-08-22 继续复核
## 5. 下一步准入顺序
来源为 \`old-candidate\`。
开发者工具若再次报错。
`,
		},
	];

	expect(auditCurrentCandidateReferences(baseline, documents)).toEqual([
		"当前只读业务不变量审计 的“小程序运行包来源：”未指向当前完整小程序 sourceRevision",
		"当前只读业务不变量审计 的“发布基线指向服务端”未指向当前服务端 release",
		"当前只读业务不变量审计 的“发布基线指向服务端”未指向当前完整小程序 sourceRevision",
		"当前只读业务不变量审计 的“来源为”未指向当前完整小程序 sourceRevision",
	]);
});

test("剩余迁移清单的执行入口不能漂移到历史候选", () => {
	const baseline = {
		serverRelease: "1b94c46",
		miniProgramCommit: "4c9cfb4",
		miniProgramSourceRevision: "4c9cfb4b1e4632a25e3e03ae4288d74ed845df3d",
	};
	const documents = [
		{
			path: "docs/migration/remaining-migration-inventory.md",
			content: `
## 2026-08-22 当前执行决策
| P1 | 真机只读验收 | 当前进行中：\`old-candidate\` 已构建 |
当前服务端已验证 release 为 \`old-server\`，小程序运行包来源为 \`old-candidate-full\`。
## 历史记录（仅供追溯）
旧候选不应参与当前执行。
`,
		},
	];

	expect(auditCurrentCandidateReferences(baseline, documents)).toEqual([
		"剩余迁移清单 的“当前进行中：”未指向当前完整小程序 sourceRevision",
		"剩余迁移清单 的“小程序运行包来源为”未指向当前完整小程序 sourceRevision",
	]);
});

test("剩余迁移清单允许当前执行章节随发布窗口更新日期", () => {
	const baseline = {
		serverRelease: "1b94c46",
		miniProgramCommit: "4c9cfb4",
		miniProgramSourceRevision: "4c9cfb4b1e4632a25e3e03ae4288d74ed845df3d",
	};
	const documents = [
		{
			path: "docs/migration/remaining-migration-inventory.md",
			content: `
## 2026-08-24 当前执行决策
| P1 | 真机只读验收 | 当前进行中：\`4c9cfb4\` 已构建 |
当前服务端已验证 release 为 \`1b94c46\`，小程序运行包来源为 \`4c9cfb4b1e4632a25e3e03ae4288d74ed845df3d\`。
## 历史记录（仅供追溯）
旧候选不应参与当前执行。
`,
		},
	];

	expect(auditCurrentCandidateReferences(baseline, documents)).toEqual([]);
});

test("文档导航的历史窗口说明必须跟随当前小程序候选", () => {
	const baseline = {
		serverRelease: "1b94c46",
		miniProgramCommit: "4c9cfb4",
		miniProgramSourceRevision: "4c9cfb4b1e4632a25e3e03ae4288d74ed845df3d",
	};
	const documents = [
		{
			path: "docs/README.md",
			content: `> 最新事实（2026-08-27）：线上服务端 release 为 \`1b94c46\`；最新小程序运行相关源码和本地 live 运行输入为 \`4c9cfb4b1e4632a25e3e03ae4288d74ed845df3d\`。
# 项目文档导航

该窗口因早于当前 \`old-candidate\` 构建。
## 发布与运行`,
		},
	];

	expect(auditCurrentCandidateReferences(baseline, documents)).toEqual([
		"文档导航 的“因早于当前”未指向当前完整小程序 sourceRevision",
	]);
});

test("当前事实入口必须同时锁定服务端和小程序完整来源", () => {
	const baseline = {
		serverRelease: "1bc8b0a8",
		miniProgramCommit: "34f0fd21",
		miniProgramSourceRevision: "34f0fd21aac33214e991de561d37dfd7071013bf",
	};
	const documents = [
		{
			path: "docs/release/current-project-baseline-2026-08-27.md",
			content: `> 当前成套验收基线（2026-08-27）：服务端 release 为 \`old-server\`；本地 live 小程序 sourceRevision 为 \`old-mini\`。
| 项目 | 当前事实 | 不能据此推出 |`,
		},
		{
			path: "docs/README.md",
			content: `> 最新事实（2026-08-27）：线上服务端 release 为 \`old-server\`；最新小程序运行相关源码和本地 live 运行输入均为 \`old-mini\`。
# 项目文档导航
该窗口因早于当前 \`34f0fd21\` 构建。
## 发布与运行`,
		},
	];

	expect(auditCurrentCandidateReferences(baseline, documents)).toEqual([
		"当前项目发布与迁移基线 的“当前成套验收基线”未指向当前服务端 release",
		"当前项目发布与迁移基线 的“当前成套验收基线”未指向当前完整小程序 sourceRevision",
		"文档导航当前事实 的“最新事实（2026-08-27）”未指向当前服务端 release",
		"文档导航当前事实 的“最新事实（2026-08-27）”未指向当前完整小程序 sourceRevision",
	]);
});

test("微信登录手册和路线图顶部当前候选不能漂移到旧运行包", () => {
	const baseline = {
		serverRelease: "1b94c46",
		miniProgramCommit: "4c9cfb4",
		miniProgramSourceRevision: "4c9cfb4b1e4632a25e3e03ae4288d74ed845df3d",
	};
	const documents = [
		{
			path: "docs/wechat-auth-login.md",
			content: `# 微信授权登录实施与验收手册
当前本地 pending 运行输入为 \`old-candidate\`。
2026-08-20 真机登录与患者同步的最新低敏证据和未完成页面边界见`,
		},
		{
			path: "docs/roadmap-next-phase.md",
			content: `# 下一阶段实施路线图
最新小程序候选事实：\`old-candidate\`
当前广度事实源：\`old-candidate\`
当前仓库事实补充：\`old-candidate\`
当前最新小程序代码候选为 \`old-candidate\`
## 历史事实源（2026-08-22，仅供追溯）`,
		},
	];

	expect(
		auditCurrentCandidateReferences(baseline, documents, {
			pendingMiniProgramSourceRevision:
				"4c9cfb4b1e4632a25e3e03ae4288d74ed845df3d",
		}),
	).toEqual([
		"微信授权登录手册 的“当前本地 pending 运行输入为”未指向当前完整小程序 sourceRevision",
		"下一阶段实施路线图 的“最新小程序候选事实”未指向当前完整小程序 sourceRevision",
		"下一阶段实施路线图 的“当前广度事实源”未指向当前完整小程序 sourceRevision",
		"下一阶段实施路线图 的“当前仓库事实补充”未指向当前完整小程序 sourceRevision",
		"下一阶段实施路线图 的“当前最新小程序代码候选为”未指向当前完整小程序 sourceRevision",
	]);
});

test("A 批次只读验收计划的 pending 运行包不能漂移到历史来源", () => {
	const baseline = {
		serverRelease: "1b94c46",
		miniProgramCommit: "4c9cfb4",
		miniProgramSourceRevision: "4c9cfb4b1e4632a25e3e03ae4288d74ed845df3d",
	};
	const documents = [
		{
			path: "docs/release/next-readonly-business-acceptance-plan-2026-08-26.md",
			content: `# A 批次低风险业务统一验收计划（2026-08-26）

## 当前候选与运行边界
| pending 运行包 | 来源为 \`old-candidate\` |

## 统一业务链路
`,
		},
	];

	expect(
		auditCurrentCandidateReferences(baseline, documents, {
			pendingMiniProgramSourceRevision:
				"4c9cfb4b1e4632a25e3e03ae4288d74ed845df3d",
		}),
	).toEqual([
		"A 批次低风险业务统一验收计划 的“来源为”未指向当前完整小程序 sourceRevision",
	]);
});

// 当前基线包含迁移总览和患者边界文档，完整 Git/文档审计在 Windows 上
// 可能超过 15 秒；提高的是测试等待上限，不放宽任何一致性断言。
test("仓库当前发布文档一致且未发布代码被正确阻断", {
	timeout: 30_000,
}, async () => {
	const result = await auditCurrentReleaseConsistency();
	// 当前仓库明确处于“新 API 候选已推送、线上 release 尚未包含最新运行代码”
	// 的发布窗口之前。这里必须把该差异保留为失败结果，防止工具测试为了变绿
	// 而绕过 release gate；文档本身仍要证明服务端和小程序候选没有发生漂移。
	expect(result).toMatchObject({
		passed: false,
		// 该断言必须与当前候选文档同步；它防止只更新正文而遗漏路线图、真机模板或
		// 发布基线测试，导致验收人员误拿已经下线的服务端 release。
		serverRelease: "1bc8b0a85f21cb58205a99ce4de0de6afe9bf240",
		// 当前线上服务与待真机验收的小程序候选必须成套锁定；这里的
		// 完整 sourceRevision 不能只写短提交号，否则 dist 可能来自另一轮构建。
		miniProgramCommit: "62cdb8f",
		miniProgramSourceRevision: "62cdb8f82b4169dd1b9a6ed3403e3be2f7422328",
	});
	expect(result.failures).toEqual([
		"服务端 release 1bc8b0a85f21cb58205a99ce4de0de6afe9bf240 之后存在未部署运行时代码：apps/api/src/modules/knowledge/index.ts, apps/api/src/modules/knowledge/service.ts",
	]);
	expect(result.serverSourceAudit).toMatchObject({
		passed: false,
		changedRuntimeFiles: [
			"apps/api/src/modules/knowledge/index.ts",
			"apps/api/src/modules/knowledge/service.ts",
		],
	});
});

test("当前业务验收协议绑定当前服务端和小程序候选", {
	timeout: 30_000,
}, async () => {
	const result = await auditCurrentReleaseConsistency();

	// 当前候选文档已经统一到同一套服务端和小程序来源；但服务端运行时代码
	// 尚未部署，所以整体结果必须保持阻断。这里精确锁定唯一失败原因，避免把
	// 文档绑定正确误判成线上 release 已完成。
	expect(result.failures).toEqual([
		"服务端 release 1bc8b0a85f21cb58205a99ce4de0de6afe9bf240 之后存在未部署运行时代码：apps/api/src/modules/knowledge/index.ts, apps/api/src/modules/knowledge/service.ts",
	]);
});

test("历史候选不被当前发布基线强制重写", () => {
	const result = auditCurrentBaselineDocuments(
		{
			serverRelease: "65219e2",
			miniProgramCommit: "4822884",
			miniProgramSourceRevision: "482288496c6de90ff86fb2f2eb54db3b9ae0bae5",
		},
		[
			{
				label: "当前候选",
				content: "65219e2 482288496c6de90ff86fb2f2eb54db3b9ae0bae5",
			},
		],
	);

	expect(result.passed).toBe(true);
	// 历史记录由文件自身的时间和 release 语义负责追溯，不应因为保留旧 hash
	// 就被强行改写成当前运行包。
	expect(result.failures).toEqual([]);
});

test("服务端 release 后的中文注释和测试 fixture 不被误报为运行时代码漂移", () => {
	const baseline = { serverRelease: "release-001" };
	const sources = new Map([
		[
			"release-001:packages/persistence/src/migrate.ts",
			"/** English comment */\nexport const timeout: number = 15000;",
		],
		[
			"HEAD:packages/persistence/src/migrate.ts",
			"/** 中文注释 */\nexport const timeout: number = 15000;",
		],
	]);

	const changedRuntimeFiles = auditServerRuntimeSourceChanges(
		baseline,
		[
			"packages/adapters/src/fixtures/replay.ts",
			"packages/persistence/src/migrate.ts",
		],
		(revision, path) => sources.get(`${revision}:${path}`),
	);

	expect(changedRuntimeFiles).toEqual([]);
});

test("服务端 release 后的运行逻辑变化必须阻止继续验收", () => {
	const baseline = { serverRelease: "release-001" };
	const sources = new Map([
		["release-001:apps/api/src/index.ts", "export const timeout = 15000;"],
		["HEAD:apps/api/src/index.ts", "export const timeout = 30000;"],
	]);
	const changedRuntimeFiles = auditServerRuntimeSourceChanges(
		baseline,
		["apps/api/src/index.ts"],
		(revision, path) => sources.get(`${revision}:${path}`),
	);

	expect(changedRuntimeFiles).toEqual(["apps/api/src/index.ts"]);
});

test("release 与 HEAD 都不存在的历史路径不构成运行时代码漂移", () => {
	const changedRuntimeFiles = auditServerRuntimeSourceChanges(
		{ serverRelease: "release-001" },
		["packages/persistence/src/removed-maintenance-tool.ts"],
		() => undefined,
	);

	expect(changedRuntimeFiles).toEqual([]);
});

test("服务端 release 漂移审计只输出文件名，不回显源码", () => {
	const calls = [];
	const result = auditServerSourceRelease(
		{ serverRelease: "release-001" },
		{
			runGit: (args) => {
				calls.push(args);
				if (args[0] === "merge-base") return "";
				if (args[0] === "diff") return "apps/api/src/index.ts\n";
				if (
					args[0] === "show" &&
					args[1] === "release-001:apps/api/src/index.ts"
				) {
					return "export const timeout = 15000;";
				}
				if (args[0] === "show" && args[1] === "HEAD:apps/api/src/index.ts") {
					return "export const timeout = 30000;";
				}
				throw new Error("unexpected git call");
			},
		},
	);

	expect(result).toEqual({
		passed: false,
		changedRuntimeFiles: ["apps/api/src/index.ts"],
		failures: [
			"服务端 release release-001 之后存在未部署运行时代码：apps/api/src/index.ts",
		],
	});
	expect(JSON.stringify(result)).not.toContain("30000");
	expect(calls.some((args) => args[0] === "merge-base")).toBe(true);
});
