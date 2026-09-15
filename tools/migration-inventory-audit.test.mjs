import { describe, expect, test } from "bun:test";
import { resolve } from "node:path";

const repositoryRoot = resolve(import.meta.dir, "..");
const auditScript = resolve(import.meta.dir, "migration-inventory-audit.mjs");

async function runAudit(environment) {
	const child = Bun.spawn(["bun", auditScript], {
		cwd: repositoryRoot,
		env: environment,
		stderr: "pipe",
		stdout: "pipe",
	});
	const [stdout, stderr] = await Promise.all([
		new Response(child.stdout).text(),
		new Response(child.stderr).text(),
	]);
	return {
		exitCode: await child.exited,
		output: `${stdout}\n${stderr}`,
	};
}

describe("旧仓库迁移审计输入边界", () => {
	test("未显式提供旧仓库时失败，而不是静默 skipped", async () => {
		const environment = { ...process.env };
		delete environment.LEGACY_HOSPITAL_ROOT;

		const result = await runAudit(environment);

		expect(result.exitCode).not.toBe(0);
		expect(result.output).toContain("LEGACY_HOSPITAL_ROOT");
		expect(result.output).not.toContain("skipped");
	});

	test("显式路径缺少旧仓库事实文件时失败", async () => {
		const environment = {
			...process.env,
			LEGACY_HOSPITAL_ROOT: "/tmp/hospital-platform-missing-legacy-root",
		};

		const result = await runAudit(environment);

		expect(result.exitCode).not.toBe(0);
		expect(result.output).toContain("Legacy page inventory unavailable");
		expect(result.output).not.toContain("skipped");
	});
});
