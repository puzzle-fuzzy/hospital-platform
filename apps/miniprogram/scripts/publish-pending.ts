import { access, cp, mkdtemp, rm } from "node:fs/promises";
import { dirname, join } from "node:path";
import {
	resolveDevelopmentMiniProgramRuntimeSnapshot,
	resolveMiniProgramSourceRevision,
} from "./runtime-provenance";
import {
	createMiniProgramRuntimeLockError,
	getMiniProgramDevelopmentRuntimePath,
	getMiniProgramPendingRuntimePath,
	isMiniProgramRuntimeLockError,
	type MiniProgramRuntimeBuildMode,
	publishMiniProgramDevelopmentRuntime,
	publishMiniProgramRuntime,
} from "./runtime-publisher";

const root = join(import.meta.dir, "..");
const repositoryRoot = join(root, "..", "..");

function resolvePublishMode(): MiniProgramRuntimeBuildMode {
	const argumentsAfterScript = process.argv.slice(2);
	if (
		argumentsAfterScript.length === 0 ||
		argumentsAfterScript[0] === "--mode=release"
	) {
		return "release";
	}
	if (
		argumentsAfterScript.length === 1 &&
		argumentsAfterScript[0] === "--mode=development"
	) {
		return "development";
	}
	throw new Error(
		"Mini program pending publish mode must be omitted, --mode=release, or --mode=development",
	);
}

const buildMode = resolvePublishMode();
const liveRuntime =
	buildMode === "development"
		? getMiniProgramDevelopmentRuntimePath(root)
		: join(root, "dist");
const pendingRuntime = getMiniProgramPendingRuntimePath(root, buildMode);
const runtimeLabel = buildMode === "development" ? "development/" : "dist/";
const publishCommand =
	buildMode === "development"
		? "pnpm --filter @hospital/miniprogram runtime:publish-pending:dev"
		: "pnpm --filter @hospital/miniprogram runtime:publish-pending";

type PendingBuildInfo = {
	schemaVersion?: unknown;
	buildMode?: unknown;
	sourceRevision?: unknown;
	sourceRevisionKind?: unknown;
	baseSourceRevision?: unknown;
	pageCount?: unknown;
};

function isGitRevision(value: unknown): value is string {
	return typeof value === "string" && /^[0-9a-f]{40}$/u.test(value);
}

function isDevelopmentSnapshot(value: unknown): value is string {
	return (
		typeof value === "string" && /^workspace-sha256:[0-9a-f]{64}$/u.test(value)
	);
}

try {
	await access(join(pendingRuntime, "build-info.json"));
} catch {
	throw new Error(
		`No validated ${buildMode} pending mini program runtime exists; run the matching build first`,
	);
}

const buildInfo = JSON.parse(
	await Bun.file(join(pendingRuntime, "build-info.json")).text(),
) as PendingBuildInfo;
if (
	typeof buildInfo.pageCount !== "number" ||
	!Number.isInteger(buildInfo.pageCount) ||
	buildInfo.pageCount <= 0
) {
	throw new Error(
		"Pending mini program runtime has invalid build-info.json provenance",
	);
}

if (buildMode === "development") {
	if (
		buildInfo.schemaVersion !== 2 ||
		buildInfo.buildMode !== "development" ||
		buildInfo.sourceRevisionKind !== "runtime-input-snapshot" ||
		!isDevelopmentSnapshot(buildInfo.sourceRevision) ||
		!isGitRevision(buildInfo.baseSourceRevision)
	) {
		throw new Error(
			"Development pending mini program runtime must contain workspace-snapshot provenance",
		);
	}
} else if (
	buildInfo.schemaVersion !== 1 ||
	buildInfo.buildMode !== undefined ||
	!isGitRevision(buildInfo.sourceRevision)
) {
	throw new Error(
		"Release pending mini program runtime must contain Git-commit provenance",
	);
}

/**
 * pending 只代表“上一次因运行目录被锁定而暂存的当前候选”，不能成为回滚旧
 * 源码的快捷入口。release 对照干净 Git 提交；development 对照当前输入快照，
 * 两个模式不共用 pending 路径或来源格式。
 */
if (buildMode === "development") {
	const expectedSnapshot =
		resolveDevelopmentMiniProgramRuntimeSnapshot(repositoryRoot);
	if (
		buildInfo.sourceRevision !== expectedSnapshot.sourceRevision ||
		buildInfo.baseSourceRevision !== expectedSnapshot.baseSourceRevision
	) {
		throw new Error(
			"Development pending mini program runtime snapshot mismatch. Run build:dev to create a current candidate",
		);
	}
} else {
	const expectedSourceRevision = resolveMiniProgramSourceRevision(
		repositoryRoot,
		process.env.HOSPITAL_MINIPROGRAM_EXPECTED_SOURCE_REVISION,
		"HOSPITAL_MINIPROGRAM_EXPECTED_SOURCE_REVISION",
	);
	if (buildInfo.sourceRevision !== expectedSourceRevision) {
		throw new Error(
			`Pending mini program runtime provenance mismatch: pending=${buildInfo.sourceRevision}, expected=${expectedSourceRevision}. Run the normal build to create a current candidate`,
		);
	}
}

/**
 * 先复制待发布候选，再交给原子发布器。这样即使用户还没有真正关闭开发者
 * 工具，发布失败也只会清理临时副本，不会误删已经通过构建校验的 pending 目录。
 */
const stagingRuntime = await mkdtemp(
	join(dirname(root), ".hospital-miniprogram-publish-"),
);

try {
	await rm(stagingRuntime, { recursive: true, force: true });
	await cp(pendingRuntime, stagingRuntime, { recursive: true });
	try {
		if (buildMode === "development") {
			await publishMiniProgramDevelopmentRuntime(stagingRuntime, liveRuntime);
		} else {
			await publishMiniProgramRuntime(stagingRuntime, liveRuntime);
		}
	} catch (error) {
		if (isMiniProgramRuntimeLockError(error)) {
			throw createMiniProgramRuntimeLockError(
				pendingRuntime,
				error,
				publishCommand,
				runtimeLabel,
			);
		}
		throw error;
	}
	await rm(pendingRuntime, { recursive: true, force: true });
	console.log(
		`${buildMode === "development" ? "Development" : "Release"} native TabBar mini program pending runtime published; source=${String(buildInfo.sourceRevision).slice(0, 24)}; ${buildInfo.pageCount} app.json page scripts are present`,
	);
} finally {
	try {
		await access(stagingRuntime);
		await rm(stagingRuntime, { recursive: true, force: true });
	} catch {
		// 原子发布成功后 staging 已被 rename；此时无需再次清理。
	}
}
