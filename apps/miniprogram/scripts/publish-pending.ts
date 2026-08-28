import { access, cp, mkdtemp, rm } from "node:fs/promises";
import { dirname, join } from "node:path";
import { resolveMiniProgramSourceRevision } from "./runtime-provenance";
import {
	createMiniProgramRuntimeLockError,
	getMiniProgramPendingRuntimePath,
	isMiniProgramRuntimeLockError,
	publishMiniProgramRuntime,
} from "./runtime-publisher";

const root = join(import.meta.dir, "..");
const repositoryRoot = join(root, "..", "..");
const liveRuntime = join(root, "dist");
const pendingRuntime = getMiniProgramPendingRuntimePath(root);

try {
	await access(join(pendingRuntime, "build-info.json"));
} catch {
	throw new Error(
		"No validated pending mini program runtime exists; run the normal build first",
	);
}

const buildInfo = JSON.parse(
	await Bun.file(join(pendingRuntime, "build-info.json")).text(),
) as { sourceRevision?: unknown; pageCount?: unknown };

if (
	typeof buildInfo.sourceRevision !== "string" ||
	!/^[0-9a-f]{40}$/u.test(buildInfo.sourceRevision) ||
	typeof buildInfo.pageCount !== "number" ||
	!Number.isInteger(buildInfo.pageCount) ||
	buildInfo.pageCount <= 0
) {
	throw new Error(
		"Pending mini program runtime has invalid build-info.json provenance",
	);
}

/**
 * pending 只代表“上一次因 dist 被锁定而暂存的当前候选”，不能成为回滚旧
 * 源码的快捷入口。发布前重新解析当前运行输入来源，若候选已经过期就拒绝
 * 操作；这样即使用户忘记清理旧 pending，也不会把已构建的新 dist 静默替换
 * 成更早的客户端版本。
 */
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

/**
 * 先复制待发布候选，再交给原子发布器。这样即使用户还没有真正关闭
 * 开发者工具，发布失败也只会清理临时副本，不会误删已经通过构建校验的
 * pending 目录；旧 `dist/` 同样由发布器负责回滚保护。
 */
const stagingRuntime = await mkdtemp(
	join(dirname(root), ".hospital-miniprogram-publish-"),
);

try {
	await rm(stagingRuntime, { recursive: true, force: true });
	await cp(pendingRuntime, stagingRuntime, { recursive: true });
	try {
		await publishMiniProgramRuntime(stagingRuntime, liveRuntime);
	} catch (error) {
		// pending 目录本身已经通过构建校验；锁定时只清理临时复制目录，
		// 保留 pending 候选，并返回与正常 build 入口一致的下一步提示。
		if (isMiniProgramRuntimeLockError(error)) {
			throw createMiniProgramRuntimeLockError(pendingRuntime, error);
		}
		throw error;
	}
	await rm(pendingRuntime, { recursive: true, force: true });
	console.log(
		`Native TabBar mini program pending runtime published; revision=${buildInfo.sourceRevision.slice(0, 7)}; ${buildInfo.pageCount} app.json page scripts are present`,
	);
} finally {
	try {
		await access(stagingRuntime);
		await rm(stagingRuntime, { recursive: true, force: true });
	} catch {
		// 原子发布成功后 staging 已被 rename；此时无需再次清理。
	}
}
