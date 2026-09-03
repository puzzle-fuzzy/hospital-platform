import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * 会影响原生小程序运行包的输入路径。
 *
 * 文档和历史验收记录不属于运行包输入；如果只修改文档，已经验证过的
 * `dist/` 不应被错误判定为另一份客户端代码。验收测试和运行包校验脚本也
 * 不会改变小程序实际产物，不能把整个 scripts 目录打包进指纹；只有构建
 * 实际运行源码、影响产物的构建脚本、发布器、构建缓存策略、共享 contract 和锁文件变化才必须
 * 推进来源指纹，避免旧运行包继续被使用。开发者工具维护的
 * `project.config.json` 只在构建时校验必要字段，故意不参与业务源码指纹，
 * 避免本地工具设置变化伪造新的业务版本。
 * 根目录 `package.json` 只承载工作区脚本和安全扫描入口，不参与小程序产物，
 * 因此不能作为运行包来源输入；否则仅修改仓库工具脚本就会制造新的客户端候选。
 */
const RUNTIME_INPUT_PATHS = [
	"apps/miniprogram/src",
	"apps/miniprogram/scripts/build.ts",
	// 发布器决定 live dist 的替换、回滚和开发者工具 404 风险，必须参与运行包来源指纹。
	"apps/miniprogram/scripts/runtime-publisher.ts",
	"apps/miniprogram/turbo.json",
	"apps/miniprogram/package.json",
	"apps/miniprogram/tsconfig.build.json",
	"packages/contracts/src",
	"pnpm-lock.yaml",
] as const;

/** 测试源码仍由 typecheck 和 Bun test 校验，但不属于微信运行包输入。 */
const NON_RUNTIME_INPUT_PATHS = [
	":(exclude,glob)apps/miniprogram/src/**/*.test.ts",
	":(exclude,glob)apps/miniprogram/src/**/*.spec.ts",
] as const;

/**
 * 正式候选只允许引用提交，而本地开发包必须能准确标识尚未提交的源码快照。
 * 这个标识不是 Git commit，调用方必须同时写入 development build mode，避免
 * 脏工作区产物在日志、验收或发布链中被误认为正式候选。
 */
export type DevelopmentMiniProgramRuntimeSnapshot = Readonly<{
	baseSourceRevision: string;
	sourceRevision: string;
}>;

function validateRevision(revision: string, variableName: string): string {
	if (!/^[0-9a-f]{40}$/.test(revision)) {
		throw new Error(
			`${variableName} must be a 40-character lowercase Git revision`,
		);
	}
	return revision;
}

function readGitOutput(repositoryRoot: string, args: string[]): string {
	const process = Bun.spawnSync(["git", ...args], {
		cwd: repositoryRoot,
		stdout: "pipe",
		stderr: "pipe",
	});
	if (!process.success) {
		throw new Error(
			`Unable to inspect mini program runtime inputs with git ${args[0] ?? "command"}; run the build from a Git checkout`,
		);
	}
	return new TextDecoder().decode(process.stdout);
}

function isNonRuntimeInputPath(path: string): boolean {
	const normalizedPath = path.replaceAll("\\", "/");
	return (
		normalizedPath.startsWith("apps/miniprogram/src/") &&
		/\.(?:test|spec)\.ts$/u.test(normalizedPath)
	);
}

/**
 * 本地开发快照只列出 Git 已跟踪或未忽略的运行输入。这与正式来源门禁的
 * `git status --untracked-files=all` 范围保持一致，同时不会把 .DS_Store、
 * private DevTools 配置等被忽略的本机噪声写进开发来源标识。
 */
function listDevelopmentRuntimeInputFiles(repositoryRoot: string): Readonly<{
	deleted: ReadonlySet<string>;
	files: readonly string[];
}> {
	const listedFiles = readGitOutput(repositoryRoot, [
		"ls-files",
		"--cached",
		"--others",
		"--exclude-standard",
		"--",
		...RUNTIME_INPUT_PATHS,
	])
		.split("\n")
		.map((entry) => entry.trim())
		.filter((entry) => entry.length > 0 && !isNonRuntimeInputPath(entry));
	const deletedFiles = readGitOutput(repositoryRoot, [
		"ls-files",
		"--deleted",
		"--",
		...RUNTIME_INPUT_PATHS,
	])
		.split("\n")
		.map((entry) => entry.trim())
		.filter((entry) => entry.length > 0 && !isNonRuntimeInputPath(entry));
	const deleted = new Set(deletedFiles);
	return {
		deleted,
		files: [...new Set([...listedFiles, ...deletedFiles])].sort((left, right) =>
			left.localeCompare(right),
		),
	};
}

function resolveCommittedRuntimeInputRevision(
	repositoryRoot: string,
	configuredRevision: string | undefined,
	variableName: string,
): string {
	const explicitRevision = configuredRevision?.trim();
	if (explicitRevision) {
		return validateRevision(explicitRevision, variableName);
	}

	const revision = readGitOutput(repositoryRoot, [
		"log",
		"-1",
		"--format=%H",
		"--",
		...RUNTIME_INPUT_PATHS,
		...NON_RUNTIME_INPUT_PATHS,
	]).trim();
	return validateRevision(revision, "Git runtime input revision");
}

/**
 * 构建来源必须对应真实进入运行包的已提交源码。
 *
 * 只读取 `git log` 不够：如果工作树里还有未提交的 TypeScript，构建会把
 * 新代码写入 dist，但来源指纹仍会落到上一个提交，验收人员就无法判断
 * 开发者工具加载的是哪一份业务逻辑。这里不输出具体文件名，避免把本地
 * 路径或未提交内容带入日志；用户仍可以通过 `git status` 在本地定位问题。
 */
function assertRuntimeInputsClean(repositoryRoot: string): void {
	const statusProcess = Bun.spawnSync(
		[
			"git",
			"status",
			"--porcelain=v1",
			"--untracked-files=all",
			"--",
			...RUNTIME_INPUT_PATHS,
			...NON_RUNTIME_INPUT_PATHS,
		],
		{
			cwd: repositoryRoot,
			stdout: "pipe",
			stderr: "pipe",
		},
	);
	if (!statusProcess.success) {
		throw new Error(
			"Unable to verify mini program runtime input cleanliness; run the build from a Git checkout",
		);
	}
	if (new TextDecoder().decode(statusProcess.stdout).trim().length > 0) {
		throw new Error(
			"Mini program runtime inputs are dirty; commit them before build or runtime verification",
		);
	}
}

/**
 * 为本地开发生成实际工作树输入的内容快照。完整文件路径和字节都进入
 * SHA-256，新增、修改、删除运行文件都会改变结果；测试文件不进入运行包，
 * 因而和正式来源规则一样不会改变开发快照。
 */
export function resolveDevelopmentMiniProgramRuntimeSnapshot(
	repositoryRoot: string,
): DevelopmentMiniProgramRuntimeSnapshot {
	const runtimeInputFiles = listDevelopmentRuntimeInputFiles(repositoryRoot);
	const digest = createHash("sha256");
	digest.update("hospital-miniprogram-development-runtime-v1\0");

	for (const relativePath of runtimeInputFiles.files) {
		digest.update(relativePath);
		digest.update("\0");
		if (runtimeInputFiles.deleted.has(relativePath)) {
			digest.update("deleted\0");
			continue;
		}

		try {
			digest.update(readFileSync(join(repositoryRoot, relativePath)));
		} catch (error) {
			throw new Error(
				`Unable to read development mini program runtime input ${relativePath}; retry after the file operation completes`,
				{ cause: error },
			);
		}
		digest.update("\0");
	}

	return {
		baseSourceRevision: resolveCommittedRuntimeInputRevision(
			repositoryRoot,
			undefined,
			"Git runtime input revision",
		),
		sourceRevision: `workspace-sha256:${digest.digest("hex")}`,
	};
}

/**
 * 解析小程序运行包的可追溯来源。
 *
 * 发布流水线可以显式传入完整提交号；本地构建/验证则读取最近一次触及
 * 运行输入的提交。这样 docs-only 提交不会无故淘汰运行包，但任何真正会
 * 改变页面、构建行为或公共输入的提交都会自然产生新的来源指纹。
 */
export function resolveMiniProgramSourceRevision(
	repositoryRoot: string,
	configuredRevision: string | undefined,
	variableName: string,
): string {
	assertRuntimeInputsClean(repositoryRoot);
	return resolveCommittedRuntimeInputRevision(
		repositoryRoot,
		configuredRevision,
		variableName,
	);
}
