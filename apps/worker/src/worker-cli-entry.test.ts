import { expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { isWorkerCliEntry } from "./worker-cli-entry";

test("worker tools require their own source or bundle basename on Windows and Linux", () => {
	for (const toolName of ["api-runtime-smoke", "provider-directory-smoke"]) {
		for (const entryPath of [
			`/release/dist/${toolName}.js`,
			`/workspace/src/${toolName}.ts`,
			`E:\\hospital-platform\\apps\\worker\\dist\\${toolName}.js`,
			`E:/hospital-platform/apps/worker/src/${toolName}.ts`,
		]) {
			expect(isWorkerCliEntry(true, toolName, entryPath)).toBeTrue();
			expect(isWorkerCliEntry(false, toolName, entryPath)).toBeFalse();
		}
		for (const entryPath of [
			"/release/dist/index.js",
			`/release/dist/${toolName}.test.ts`,
			`/release/${toolName}.js/index.js`,
			"",
		]) {
			expect(isWorkerCliEntry(true, toolName, entryPath)).toBeFalse();
		}
	}
});

async function runIsolatedEntry(entryPath: string) {
	const child = Bun.spawn([process.execPath, "--no-env-file", entryPath], {
		cwd: dirname(entryPath),
		// 不继承开发机 provider、数据库或 secret 环境，且禁止 .env 自动加载。
		env: { NODE_ENV: "test", LOG_LEVEL: "info" },
		stdout: "pipe",
		stderr: "pipe",
	});
	const [exitCode, stdout, stderr] = await Promise.all([
		child.exited,
		new Response(child.stdout).text(),
		new Response(child.stderr).text(),
	]);
	return { exitCode, stdout, stderr };
}

async function removeOutputDirectory(directory: string) {
	const resolved = resolve(directory);
	if (
		dirname(resolved) !== resolve(tmpdir()) ||
		!basename(resolved).startsWith("hospital-worker-")
	) {
		throw new Error(
			"Worker test output must stay inside its temporary directory",
		);
	}
	await rm(resolved, { recursive: true, force: true });
}

test("bundled worker entry does not execute smoke CLIs or inherit their failure exit code", async () => {
	const outputDirectory = await mkdtemp(
		join(tmpdir(), "hospital-worker-entry-"),
	);
	try {
		const build = await Bun.build({
			entrypoints: [join(import.meta.dir, "index.ts")],
			outdir: outputDirectory,
			target: "bun",
		});
		expect(build.success).toBeTrue();
		const result = await runIsolatedEntry(join(outputDirectory, "index.js"));
		expect(result.stdout).not.toContain("runtime.smoke.");
		expect(result.stdout).not.toContain("provider.smoke.");
		expect(result.stderr).toBe("");
		expect(result.stdout).toContain("service.start.skipped");
		expect(result.exitCode).toBe(0);
	} finally {
		await removeOutputDirectory(outputDirectory);
	}
}, 30_000);

test("standalone source and bundled smoke tools retain configuration validation and failure exit code", async () => {
	const outputDirectory = await mkdtemp(
		join(tmpdir(), "hospital-worker-tools-"),
	);
	try {
		const build = await Bun.build({
			entrypoints: [
				join(import.meta.dir, "api-runtime-smoke.ts"),
				join(import.meta.dir, "provider-directory-smoke.ts"),
			],
			outdir: outputDirectory,
			target: "bun",
		});
		expect(build.success).toBeTrue();
		for (const [toolName, event] of [
			["api-runtime-smoke", "runtime.smoke.configuration.failed"],
			["provider-directory-smoke", "provider.smoke.configuration.failed"],
		] as const) {
			for (const entryPath of [
				join(outputDirectory, `${toolName}.js`),
				join(import.meta.dir, `${toolName}.ts`),
			]) {
				const result = await runIsolatedEntry(entryPath);
				expect(result.stdout).toContain(event);
				expect(result.stderr).toBe("");
				expect(result.exitCode).toBe(1);
			}
		}
	} finally {
		await removeOutputDirectory(outputDirectory);
	}
}, 30_000);
