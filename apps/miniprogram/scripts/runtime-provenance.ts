/**
 * 会影响原生小程序运行包的输入路径。
 *
 * 文档和历史验收记录不属于运行包输入；如果只修改文档，已经验证过的
 * `dist/` 不应被错误判定为另一份客户端代码。验收测试和运行包校验脚本也
 * 不会改变小程序实际产物，不能把整个 scripts 目录打包进指纹；只有构建
 * 脚本及其来源解析辅助、构建缓存策略、共享 contract 和锁文件变化才必须
 * 推进来源指纹，避免旧运行包继续被使用。开发者工具维护的
 * `project.config.json` 只在构建时校验必要字段，故意不参与业务源码指纹，
 * 避免本地工具设置变化伪造新的业务版本。
 */
const RUNTIME_INPUT_PATHS = [
	"apps/miniprogram/src",
	"apps/miniprogram/scripts/build.ts",
	// 发布器决定 live dist 的替换、回滚和开发者工具 404 风险，必须参与运行包来源指纹。
	"apps/miniprogram/scripts/runtime-publisher.ts",
	"apps/miniprogram/scripts/runtime-provenance.ts",
	"apps/miniprogram/turbo.json",
	"apps/miniprogram/package.json",
	"apps/miniprogram/tsconfig.build.json",
	"packages/contracts/src",
	"package.json",
	"pnpm-lock.yaml",
] as const;

function validateRevision(revision: string, variableName: string): string {
	if (!/^[0-9a-f]{40}$/.test(revision)) {
		throw new Error(
			`${variableName} must be a 40-character lowercase Git revision`,
		);
	}
	return revision;
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
	const explicitRevision = configuredRevision?.trim();
	if (explicitRevision) {
		return validateRevision(explicitRevision, variableName);
	}

	const revisionProcess = Bun.spawnSync(
		["git", "log", "-1", "--format=%H", "--", ...RUNTIME_INPUT_PATHS],
		{
			cwd: repositoryRoot,
			stdout: "pipe",
			stderr: "pipe",
		},
	);
	const revision = new TextDecoder().decode(revisionProcess.stdout).trim();
	if (!revisionProcess.success) {
		throw new Error(
			`Unable to resolve the mini program source revision; set ${variableName} in a non-Git environment`,
		);
	}
	return validateRevision(revision, "Git runtime input revision");
}
