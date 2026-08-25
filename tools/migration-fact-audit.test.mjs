import { describe, expect, test } from "bun:test";
import { auditMigrationDocumentation } from "./migration-fact-audit.mjs";

describe("迁移事实文档审计", () => {
	test("当前准入目录与核心交接文档保持同一口径", async () => {
		const report = await auditMigrationDocumentation(process.cwd());

		expect(report).toMatchObject({
			frozenGateCount: 34,
			contractFeatureKeyCount: 23,
			failures: [],
			passed: true,
		});
	});
});
