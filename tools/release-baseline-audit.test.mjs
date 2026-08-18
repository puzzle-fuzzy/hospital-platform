import { expect, test } from "bun:test";
import {
	auditCurrentBaselineDocuments,
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

test("仓库当前发布文档保持同一套候选", async () => {
	const result = await auditCurrentReleaseConsistency();
	expect(result).toMatchObject({
		passed: true,
		serverRelease: "b7c9451",
		miniProgramCommit: "379eae2",
		miniProgramSourceRevision: "379eae2a528265df900030cea6e8dc45a82902c1",
	});
	expect(result.failures).toEqual([]);
});
