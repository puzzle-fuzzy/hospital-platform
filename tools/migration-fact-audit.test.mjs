import { describe, expect, test } from "bun:test";
import { copyFile, mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { auditMigrationDocumentation } from "./migration-fact-audit.mjs";

const AUDITED_DOCUMENTS = [
	"docs/迁移/迁移就绪报告.md",
	"docs/迁移/契约接入目录-2026-08-25.md",
	"docs/迁移/广度优先迁移计划-2026-08-25.md",
	"docs/迁移/当前广度审计-2026-08-26.md",
	"docs/发布/广度优先页面覆盖-2026-08-25.md",
];

describe("迁移事实文档审计", () => {
	test("当前准入目录与核心交接文档保持同一口径", async () => {
		const report = await auditMigrationDocumentation(process.cwd());

		expect(report).toMatchObject({
			frozenGateCount: 33,
			contractFeatureKeyCount: 22,
			failures: [],
			passed: true,
		});
	});

	test("当前事实不能藏在历史段落中掩盖顶部旧候选", async () => {
		const fixtureRoot = await mkdtemp(
			join(tmpdir(), "hospital-migration-fact-audit-"),
		);
		try {
			for (const relativePath of AUDITED_DOCUMENTS) {
				const destination = join(fixtureRoot, relativePath);
				await mkdir(dirname(destination), { recursive: true });
				await copyFile(join(process.cwd(), relativePath), destination);
			}

			const coveragePath = join(
				fixtureRoot,
				"docs/发布/广度优先页面覆盖-2026-08-25.md",
			);
			const original = await Bun.file(coveragePath).text();
			const currentBoundary = original.indexOf("\n## 结论");
			expect(currentBoundary).toBeGreaterThan(0);
			const currentPrefix = original.slice(0, currentBoundary);
			const historicalSuffix = original.slice(currentBoundary);
			const stalePrefix = currentPrefix
				.replace("38 个原生页面", "40 个原生页面")
				.replace("surface-only=23", "surface-only=25")
				.replace(
					"当前小程序源码与 live 运行输入为 `ce1c2179b57fe2783066b51f8621220224982928`",
					"当前小程序源码与 live 运行输入为 `02dbf10`",
				);
			await Bun.write(coveragePath, `${stalePrefix}${historicalSuffix}`);

			const report = await auditMigrationDocumentation(fixtureRoot);
			expect(report.passed).toBe(false);
			expect(report.failures).toContain(
				"docs/发布/广度优先页面覆盖-2026-08-25.md 当前事实区仍含历史候选：64 个旧页面、40 个原生页面",
			);
		} finally {
			await rm(fixtureRoot, { recursive: true, force: true });
		}
	});
});
