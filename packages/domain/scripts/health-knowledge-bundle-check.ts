import { isAbsolute, resolve } from "node:path";
import {
	HealthKnowledgeImportValidationError,
	validateHealthKnowledgeImportBundle,
} from "../src/index.ts";
import { normalizeHealthKnowledgeBundleCliArguments } from "../src/knowledge-bundle-cli.ts";

const USAGE =
	"用法：pnpm --filter @hospital/domain knowledge:bundle:check -- <脱敏健康知识 bundle.json>";

/**
 * pnpm 会把 workspace script 的工作目录切到 package 目录，导致用户从仓库根目录
 * 传入的 `.local/...` 相对路径被错误解析。`INIT_CWD` 是 pnpm 保留的原始调用目录；
 * 直接用 Bun 执行时则回退到当前工作目录。绝对路径保持不变，避免改变审核者的输入。
 */
function resolveInputPath(inputPath: string): string {
	if (isAbsolute(inputPath)) return inputPath;
	const invocationDirectory = process.env.INIT_CWD?.trim() || process.cwd();
	return resolve(invocationDirectory, inputPath);
}

/**
 * 这是导入前的只读门禁，不连接 MySQL、Redis，也不改变患者端 route gate。
 * 输出只包含版本、状态和数量；医学正文、患者字段和原始异常文本都不打印。
 */
async function main(): Promise<void> {
	const { inputPath, extraArguments } =
		normalizeHealthKnowledgeBundleCliArguments(process.argv.slice(2));
	if (!inputPath || extraArguments.length > 0 || inputPath === "--help") {
		console.error(USAGE);
		process.exitCode = inputPath === "--help" ? 0 : 2;
		return;
	}

	try {
		const input = await Bun.file(resolveInputPath(inputPath)).json();
		const summary = validateHealthKnowledgeImportBundle(input);
		console.log(
			JSON.stringify(
				{
					ok: true,
					summary,
				},
				null,
				2,
			),
		);
	} catch (error) {
		if (error instanceof HealthKnowledgeImportValidationError) {
			console.error(
				JSON.stringify(
					{
						ok: false,
						error: { code: "invalid-bundle", path: error.path },
					},
					null,
					2,
				),
			);
		} else if (error instanceof SyntaxError) {
			console.error(
				JSON.stringify(
					{
						ok: false,
						error: { code: "invalid-json", path: "json" },
					},
					null,
					2,
				),
			);
		} else {
			// 文件不存在、权限错误等只返回稳定分类，避免泄露底层路径或异常文本。
			console.error(
				JSON.stringify(
					{
						ok: false,
						error: { code: "input-unreadable", path: "input" },
					},
					null,
					2,
				),
			);
		}
		process.exitCode = 1;
	}
}

await main();
