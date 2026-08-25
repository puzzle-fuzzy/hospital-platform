import { describe, expect, test } from "bun:test";
import { buildMigrationReadinessReport } from "./migration-readiness-report.mjs";

describe("全项目迁移 readiness 报告", () => {
	test("区分入口结构完成、运行包发布和真实业务完成", async () => {
		const report = await buildMigrationReadinessReport(
			process.cwd(),
			"2026-08-25T00:00:00.000Z",
		);

		expect(report.entryCoverage.legacy.legacyPageCount).toBe(64);
		expect(report.entryCoverage.nativePageCount).toBe(20);
		expect(report.entryCoverage.legacy.blockedPageCount).toBe(40);
		expect(report.entryCoverage.passed).toBe(true);
		expect(report.readOnly.domainCount).toBe(5);
		expect(report.readOnly.passed).toBe(true);
		expect(report.providerIntake.documentCount).toBe(4);
		expect(report.providerIntake.documentIdCount).toBe(31);
		expect(report.providerIntake.confirmedDocumentCount).toBe(0);
		expect(report.providerIntake.businessReady).toBe(false);
		expect(report.runtime.candidateRuntimeAligned).toBe(false);
		expect(report.runtime.publicationRequired).toBe(true);
		expect(report.businessCompletion.passed).toBe(false);
		expect(report.structuralAuditPassed).toBe(true);
	});
});
