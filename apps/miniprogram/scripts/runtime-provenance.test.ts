import { expect, test } from "bun:test";
import {
	access,
	mkdir,
	mkdtemp,
	readdir,
	rm,
	writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resolveMiniProgramSourceRevision } from "./runtime-provenance";
import {
	findForbiddenWorkspaceImports,
	findMissingRelativeImports,
	isMiniProgramRuntimeLockError,
	listRuntimeFiles,
	publishMiniProgramRuntime,
} from "./runtime-publisher";

function runGit(repositoryRoot: string, args: string[]): void {
	const result = Bun.spawnSync(["git", ...args], {
		cwd: repositoryRoot,
		stdout: "pipe",
		stderr: "pipe",
	});
	if (!result.success) {
		throw new Error(`git test command failed: ${args[0] ?? "unknown"}`);
	}
}

async function createCommittedRuntimeFixture(): Promise<string> {
	const repositoryRoot = await mkdtemp(
		join(tmpdir(), "hospital-mini-provenance-"),
	);
	await mkdir(join(repositoryRoot, "apps/miniprogram/src"), {
		recursive: true,
	});
	await writeFile(
		join(repositoryRoot, "apps/miniprogram/src/page.ts"),
		"export const page = true;\n",
		"utf8",
	);
	runGit(repositoryRoot, ["init"]);
	runGit(repositoryRoot, ["config", "user.email", "test@example.invalid"]);
	runGit(repositoryRoot, ["config", "user.name", "runtime-provenance-test"]);
	runGit(repositoryRoot, ["add", "."]);
	runGit(repositoryRoot, ["commit", "-m", "fixture"]);
	return repositoryRoot;
}

test("运行包来源解析只接受干净的已提交运行输入", async () => {
	const repositoryRoot = await createCommittedRuntimeFixture();
	try {
		const committedRevision = resolveMiniProgramSourceRevision(
			repositoryRoot,
			undefined,
			"TEST_SOURCE_REVISION",
		);
		expect(committedRevision).toMatch(/^[0-9a-f]{40}$/);

		await writeFile(
			join(repositoryRoot, "apps/miniprogram/src/page.ts"),
			"export const page = false;\n",
			"utf8",
		);
		expect(() =>
			resolveMiniProgramSourceRevision(
				repositoryRoot,
				undefined,
				"TEST_SOURCE_REVISION",
			),
		).toThrow("runtime inputs are dirty");
	} finally {
		await rm(repositoryRoot, { recursive: true, force: true });
	}
});

test("开发者工具配置改动不冒充业务源码版本", async () => {
	const repositoryRoot = await createCommittedRuntimeFixture();
	try {
		await mkdir(join(repositoryRoot, "apps/miniprogram"), {
			recursive: true,
		});
		await writeFile(
			join(repositoryRoot, "apps/miniprogram/project.config.json"),
			'{"libVersion":"3.17.1"}\n',
			"utf8",
		);
		const revision = resolveMiniProgramSourceRevision(
			repositoryRoot,
			undefined,
			"TEST_SOURCE_REVISION",
		);
		expect(revision).toMatch(/^[0-9a-f]{40}$/);
	} finally {
		await rm(repositoryRoot, { recursive: true, force: true });
	}
});

test("测试与规格文件改动不改变微信运行包来源", async () => {
	const repositoryRoot = await createCommittedRuntimeFixture();
	try {
		const committedRevision = resolveMiniProgramSourceRevision(
			repositoryRoot,
			undefined,
			"TEST_SOURCE_REVISION",
		);
		for (const fileName of ["page.test.ts", "page.spec.ts"]) {
			await writeFile(
				join(repositoryRoot, "apps/miniprogram/src", fileName),
				"export const testOnly = true;\n",
				"utf8",
			);
		}
		runGit(repositoryRoot, ["add", "."]);
		runGit(repositoryRoot, ["commit", "-m", "test-only"]);
		const revisionAfterTestOnlyCommit = resolveMiniProgramSourceRevision(
			repositoryRoot,
			undefined,
			"TEST_SOURCE_REVISION",
		);
		// 测试提交不进入 dist，因此不应迫使同一份业务运行包更换来源。
		expect(revisionAfterTestOnlyCommit).toBe(committedRevision);
	} finally {
		await rm(repositoryRoot, { recursive: true, force: true });
	}
});

test("运行包发布先完成 staging，再替换 live，旧文件不会在编译期间被清空", async () => {
	const workspace = await mkdtemp(
		join(tmpdir(), "hospital-mini-runtime-publish-"),
	);
	const watchedProject = join(workspace, "miniprogram");
	const liveRuntime = join(watchedProject, "dist");
	const stagingRuntime = join(workspace, "staging");
	try {
		await mkdir(join(liveRuntime, "pages/index"), { recursive: true });
		await writeFile(
			join(liveRuntime, "pages/index/index.js"),
			"old-runtime",
			"utf8",
		);
		await writeFile(join(liveRuntime, "stale.js"), "stale-runtime", "utf8");

		await mkdir(join(stagingRuntime, "pages/index"), { recursive: true });
		await writeFile(
			join(stagingRuntime, "pages/index/index.js"),
			"new-runtime",
			"utf8",
		);
		await writeFile(join(stagingRuntime, "app.json"), "{}", "utf8");
		await writeFile(
			join(stagingRuntime, "build-info.json"),
			'{"schemaVersion":1}',
			"utf8",
		);

		await publishMiniProgramRuntime(stagingRuntime, liveRuntime);

		expect(
			await Bun.file(join(liveRuntime, "pages/index/index.js")).text(),
		).toBe("new-runtime");
		await expect(access(join(liveRuntime, "stale.js"))).rejects.toThrow();
		expect(await listRuntimeFiles(liveRuntime)).toContain("app.json");
		expect(
			(await readdir(watchedProject)).filter((entry) =>
				entry.startsWith(".hospital-miniprogram-backup-"),
			).length,
		).toBe(0);
	} finally {
		await rm(workspace, { recursive: true, force: true });
	}
});

test("运行包发布失败时保留旧 live 目录", async () => {
	const workspace = await mkdtemp(
		join(tmpdir(), "hospital-mini-runtime-rollback-"),
	);
	const liveRuntime = join(workspace, "dist");
	const missingStagingRuntime = join(workspace, "missing-staging");
	try {
		await mkdir(liveRuntime, { recursive: true });
		await writeFile(join(liveRuntime, "app.js"), "old-runtime", "utf8");

		await expect(
			publishMiniProgramRuntime(missingStagingRuntime, liveRuntime),
		).rejects.toThrow("staging runtime does not exist");
		expect(await Bun.file(join(liveRuntime, "app.js")).text()).toBe(
			"old-runtime",
		);
	} finally {
		await rm(workspace, { recursive: true, force: true });
	}
});

test("运行包目录被开发者工具占用时识别为可恢复锁定错误", () => {
	expect(isMiniProgramRuntimeLockError({ code: "EPERM" })).toBe(true);
	expect(isMiniProgramRuntimeLockError({ code: "EBUSY" })).toBe(true);
	expect(isMiniProgramRuntimeLockError({ code: "EACCES" })).toBe(true);
	expect(isMiniProgramRuntimeLockError({ code: "ENOENT" })).toBe(false);
	expect(isMiniProgramRuntimeLockError(new Error("locked"))).toBe(false);
});

test("运行包拒绝 pnpm workspace 裸模块依赖", async () => {
	const workspace = await mkdtemp(
		join(tmpdir(), "hospital-mini-runtime-workspace-import-"),
	);
	try {
		await mkdir(workspace, { recursive: true });
		await writeFile(
			join(workspace, "page.js"),
			'const contracts = require("@hospital/contracts");\n',
			"utf8",
		);
		await writeFile(
			join(workspace, "safe-page.js"),
			'const local = require("./local");\n',
			"utf8",
		);
		await writeFile(
			join(workspace, "local.js"),
			"module.exports = true;\n",
			"utf8",
		);

		expect(await findForbiddenWorkspaceImports(workspace)).toEqual(["page.js"]);
	} finally {
		await rm(workspace, { recursive: true, force: true });
	}
});

test("运行包拒绝指向缺失文件的相对模块引用", async () => {
	const workspace = await mkdtemp(
		join(tmpdir(), "hospital-mini-runtime-missing-import-"),
	);
	try {
		await writeFile(
			join(workspace, "page.js"),
			'const testOnly = require("./single-flight.test");\n',
			"utf8",
		);

		expect(await findMissingRelativeImports(workspace)).toEqual([
			"page.js -> ./single-flight.test",
		]);
	} finally {
		await rm(workspace, { recursive: true, force: true });
	}
});
