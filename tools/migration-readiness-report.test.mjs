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
		expect(report.entryCoverage.legacy.blockedPageCount).toBe(39);
		expect(report.entryCoverage.frozenBoundary).toMatchObject({
			domainCount: 34,
			legacyEntryCount: 39,
			legacyActionCount: 13,
			coveredEntryCount: 52,
			actionFeatureKeyCount: 16,
			uncoveredActionFeatureKeys: [],
			featureStatusCallCount: 31,
			featureStatusFeatureKeyCount: 27,
			uncoveredFeatureStatusKeys: [],
			passed: true,
		});
		expect(report.entryCoverage.frozenBoundary.failures).toEqual([]);
		expect(report.entryCoverage.legacy.domainCoverage).toHaveLength(7);
		expect(report.migrationQueue).toHaveLength(6);
		expect(
			report.entryCoverage.legacy.domainCoverage.find(
				(domain) => domain.domain === "健康",
			),
		).toMatchObject({ pageCount: 34, blockedPageCount: 27 });
		expect(
			report.entryCoverage.legacy.domainCoverage.find(
				(domain) => domain.domain === "首页",
			),
		).toMatchObject({ pageCount: 2, blockedPageCount: 0 });
		expect(report.entryCoverage.passed).toBe(true);
		expect(report.migrationBreadth.passed).toBe(true);
		expect(report.migrationBreadth.pages).toHaveLength(2);
		expect(report.migrationBreadth.tabBarPageCount).toBe(4);
		expect(report.migrationBreadth.interactionAudit.pageCount).toBe(20);
		expect(report.migrationBreadth.interactionAudit.failures).toEqual([]);
		expect(report.readOnly.domainCount).toBe(5);
		expect(report.readOnly.semanticStateCount).toBe(35);
		expect(report.readOnly.semanticFailures).toEqual([]);
		expect(report.readOnly.passed).toBe(true);
		expect(report.providerIntake.documentCount).toBe(4);
		expect(report.providerIntake.documentIdCount).toBe(31);
		expect(report.providerIntake.confirmedDocumentCount).toBe(0);
		expect(report.providerIntake.businessReady).toBe(false);
		expect(report.clinicalContract.domainCount).toBe(4);
		expect(report.clinicalContract.structuredGate.passed).toBe(true);
		expect(report.clinicalContract.structuredGate.domains).toHaveLength(4);
		expect(report.clinicalContract.passed).toBe(true);
		expect(report.healthContent.routeRegistered).toBe(true);
		expect(report.healthContent.codeReady).toBe(true);
		expect(report.healthContent.reviewedBundlePresent).toBe(false);
		expect(report.healthContent.businessReady).toBe(false);
		if (report.healthContent.sourceSnapshotPresent) {
			expect(report.healthContent.sourceSnapshotStatus).toBe("audited");
			expect(report.healthContent.reviewQueue).toMatchObject({
				publishable: false,
				passed: false,
			});
			expect(
				report.healthContent.reviewQueue.unresolvedGateCount,
			).toBeGreaterThan(0);
		} else {
			expect(report.healthContent.sourceSnapshotStatus).toBe("missing");
			expect(report.healthContent.reviewQueue).toBeNull();
		}
		expect(report.runtime.candidateRuntimeAligned).toBe(false);
		expect(report.runtime.publicationRequired).toBe(true);
		expect(report.deviceEvidence.domainCount).toBe(9);
		expect(report.deviceEvidence.allPending).toBe(true);
		expect(report.deviceEvidence.passed).toBe(false);
		expect(report.deviceEvidence.candidateMatchesPendingRuntime).toBe(true);
		expect(report.deviceEvidence.manifestPath).toBe(
			`docs/release/device-evidence-${report.runtime.pending.sourceRevision.slice(0, 7)}-pending.json`,
		);
		expect(report.migrationQueue.map((batch) => batch.id)).toEqual([
			"A-readonly-evidence",
			"B-health-content",
			"C-clinical-readonly-contracts",
			"D-patient-and-convenience-write",
			"E-external-entry",
			"F-payment-and-writeback",
		]);
		expect(report.migrationQueue[0].stage).toBe("awaiting-evidence");
		expect(report.migrationQueue[0].codeReady).toBe(true);
		expect(report.migrationQueue[1].stage).toBe("awaiting-reviewed-bundle");
		expect(report.migrationQueue[1].reviewedBundlePresent).toBe(false);
		expect(report.migrationQueue[1].businessReady).toBe(false);
		expect(report.migrationQueue[2].codeReady).toBe(false);
		expect(report.migrationQueue[3].blockedPageCount).toBe(4);
		expect(report.migrationQueue[4].blockedPageCount).toBe(9);
		expect(report.migrationQueue[5].blockedPageCount).toBe(7);
		expect(report.businessCompletion.codeReadyDomainCount).toBe(5);
		expect(report.businessCompletion.realEvidenceReadyDomainCount).toBe(0);
		expect(report.businessCompletion.passed).toBe(false);
		expect(report.structuralAuditPassed).toBe(true);
	});
});
