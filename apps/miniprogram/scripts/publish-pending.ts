import { access, cp, mkdtemp, rm } from "node:fs/promises";
import { dirname, join } from "node:path";
import { publishMiniProgramRuntime } from "./runtime-publisher";

const root = join(import.meta.dir, "..");
const liveRuntime = join(root, "dist");
const pendingRuntime = join(dirname(root), ".hospital-miniprogram-pending");

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
	await publishMiniProgramRuntime(stagingRuntime, liveRuntime);
	await rm(pendingRuntime, { recursive: true, force: true });
	console.log(
		`Native mini program pending runtime published; revision=${buildInfo.sourceRevision.slice(0, 7)}; ${buildInfo.pageCount} app.json page scripts are present`,
	);
} finally {
	try {
		await access(stagingRuntime);
		await rm(stagingRuntime, { recursive: true, force: true });
	} catch {
		// 原子发布成功后 staging 已被 rename；此时无需再次清理。
	}
}
