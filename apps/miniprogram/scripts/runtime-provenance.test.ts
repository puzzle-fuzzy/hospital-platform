import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "bun:test";
import { resolveMiniProgramSourceRevision } from "./runtime-provenance";

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
			"{\"libVersion\":\"3.17.1\"}\n",
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
