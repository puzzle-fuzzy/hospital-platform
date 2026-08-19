import { expect, test } from "bun:test";
import {
	auditCurrentBaselineDocuments,
	auditCurrentExecutionSection,
	auditCurrentReleaseConsistency,
	extractCurrentBaseline,
} from "./release-baseline-audit.mjs";

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

test("仓库当前发布文档保持同一套候选", async () => {
	const result = await auditCurrentReleaseConsistency();
	// 这里固定当前验收候选，而不是只断言 passed=true：候选文档、运行包来源
	// 和路线图如果被部分更新，单独的发布审计仍可能通过，但真机就会拿到
	// 与服务端不配套的旧包。每次切换候选时必须同步更新这组三项断言。
	expect(result).toMatchObject({
		passed: true,
		serverRelease: "968af78",
		// 当前线上服务与待真机验收的小程序候选必须成套锁定；这里的
		// 完整 sourceRevision 不能只写短提交号，否则 dist 可能来自另一轮构建。
		miniProgramCommit: "4822884",
		miniProgramSourceRevision: "482288496c6de90ff86fb2f2eb54db3b9ae0bae5",
	});
	expect(result.failures).toEqual([]);
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
