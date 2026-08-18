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
	expect(result).toMatchObject({
		passed: true,
		serverRelease: "b7c9451",
		miniProgramCommit: "f4b90f2",
		miniProgramSourceRevision: "f4b90f273bc19054443c9e2b978601e8ed3eab17",
	});
	expect(result.failures).toEqual([]);
});
