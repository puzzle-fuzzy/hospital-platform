import {
	access,
	mkdtemp,
	mkdir,
	readdir,
	rm,
	writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "bun:test";
import { resolveMiniProgramSourceRevision } from "./runtime-provenance";
import {
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

test("运行包发布先完成 staging，再替换 live，旧文件不会在编译期间被清空", async () => {
	const workspace = await mkdtemp(join(tmpdir(), "hospital-mini-runtime-publish-"));
	const liveRuntime = join(workspace, "dist");
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
			(await readdir(workspace)).filter((entry) =>
				entry.startsWith(".hospital-runtime-backup-"),
		).length,
		).toBe(0);
	} finally {
		await rm(workspace, { recursive: true, force: true });
	}
});

test("运行包发布失败时保留旧 live 目录", async () => {
	const workspace = await mkdtemp(join(tmpdir(), "hospital-mini-runtime-rollback-"));
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
