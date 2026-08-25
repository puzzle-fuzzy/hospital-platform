import { expect, test } from "bun:test";
import { parseHealthKnowledgeImportArguments } from "./health-knowledge-bundle-import";

test("健康知识 staging 导入只接受显式确认参数和一个 bundle 路径", () => {
	expect(
		parseHealthKnowledgeImportArguments([
			"--",
			"--confirm-staging",
			".local/health/bundle.json",
		]),
	).toEqual({
		inputPath: ".local/health/bundle.json",
		confirmed: true,
		extraArguments: [],
		showHelp: false,
	});

	const withoutConfirmation = parseHealthKnowledgeImportArguments([
		"bundle.json",
	]);
	expect(withoutConfirmation.confirmed).toBe(false);
	expect(withoutConfirmation.inputPath).toBe("bundle.json");
});

test("健康知识 staging 导入拒绝未知参数和多个输入文件", () => {
	const parsed = parseHealthKnowledgeImportArguments([
		"--confirm-staging",
		"bundle.json",
		"--database-url",
		"mysql://example.invalid",
	]);

	expect(parsed.extraArguments).toEqual([
		"--database-url",
		"mysql://example.invalid",
	]);
	// CLI 主流程会把 extraArguments 视为参数错误，不允许命令行覆盖受控环境。
	expect(parsed.confirmed).toBe(true);
});

test("健康知识 staging 导入帮助不会触发数据库连接", () => {
	expect(parseHealthKnowledgeImportArguments(["--help"])).toEqual({
		inputPath: undefined,
		confirmed: false,
		extraArguments: [],
		showHelp: true,
	});
});
