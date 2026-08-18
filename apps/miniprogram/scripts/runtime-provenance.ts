/**
 * 会影响原生小程序运行包的输入路径。
 *
 * 文档和历史验收记录不属于运行包输入；如果只修改文档，已经验证过的
 * `dist/` 不应被错误判定为另一份客户端代码。验收测试和运行包校验脚本也
 * 不会改变小程序实际产物，不能把整个 scripts 目录打包进指纹；只有构建
 * 脚本及其来源解析辅助、构建缓存策略、共享 contract、小程序配置和锁文件
 * 变化才必须推进来源指纹，避免旧运行包继续被使用。构建缓存策略虽然不改变
 * 页面代码，却决定 `dist/build-info.json` 是否可能复用旧提交产物，因此不能
 * 被排除在运行包来源之外。
 */
const RUNTIME_INPUT_PATHS = [
	"apps/miniprogram/src",
	"apps/miniprogram/scripts/build.ts",
	"apps/miniprogram/scripts/runtime-provenance.ts",
	"apps/miniprogram/turbo.json",
	"apps/miniprogram/package.json",
	"apps/miniprogram/tsconfig.build.json",
	"apps/miniprogram/project.config.json",
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
