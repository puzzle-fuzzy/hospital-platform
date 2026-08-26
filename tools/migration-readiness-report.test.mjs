import { describe, expect, test } from "bun:test";
import { buildMigrationReadinessReport } from "./migration-readiness-report.mjs";

describe("全项目迁移 readiness 报告", () => {
	test("区分入口结构完成、运行包发布和真实业务完成", async () => {
		const report = await buildMigrationReadinessReport(
			process.cwd(),
			"2026-08-25T00:00:00.000Z",
		);

		expect(report.entryCoverage.legacy.legacyPageCount).toBe(64);
		expect(report.entryCoverage.nativePageCount).toBe(40);
		expect(report.entryCoverage.legacy.blockedPageCount).toBe(7);
		expect(report.entryCoverage.frozenBoundary).toMatchObject({
			domainCount: 34,
			legacyEntryCount: 39,
			legacyActionCount: 13,
			coveredEntryCount: 52,
			actionFeatureKeyCount: 16,
			uncoveredActionFeatureKeys: [],
			featureStatusCallCount: 14,
			featureStatusFeatureKeyCount: 14,
			uncoveredFeatureStatusKeys: [],
			passed: true,
		});
		expect(report.entryCoverage.frozenBoundary.failures).toEqual([]);
		expect(report.entryCoverage.frozenBoundary.batchCoverage).toMatchObject([
			{
				batchId: "A-readonly-evidence",
				gateCount: 4,
				legacyEntryCount: 3,
				legacyActionCount: 2,
			},
			{
				batchId: "B-health-content",
				gateCount: 0,
				legacyEntryCount: 0,
				legacyActionCount: 0,
			},
			{
				batchId: "C-clinical-readonly-contracts",
				gateCount: 4,
				legacyEntryCount: 4,
				legacyActionCount: 0,
			},
			{
				batchId: "D-patient-and-convenience-write",
				gateCount: 11,
				legacyEntryCount: 22,
				legacyActionCount: 1,
			},
			{
				batchId: "E-external-entry",
				gateCount: 8,
				legacyEntryCount: 3,
				legacyActionCount: 6,
			},
			{
				batchId: "F-payment-and-writeback",
				gateCount: 7,
				legacyEntryCount: 7,
				legacyActionCount: 4,
			},
		]);
		expect(report.entryCoverage.legacy.domainCoverage).toHaveLength(7);
		expect(report.migrationQueue).toHaveLength(6);
		expect(
			report.entryCoverage.legacy.domainCoverage.find(
				(domain) => domain.domain === "健康",
			),
		).toMatchObject({ pageCount: 34, blockedPageCount: 5 });
		expect(
			report.entryCoverage.legacy.domainCoverage.find(
				(domain) => domain.domain === "首页",
			),
		).toMatchObject({ pageCount: 2, blockedPageCount: 0 });
		expect(report.entryCoverage.passed).toBe(true);
		expect(report.migrationBreadth.passed).toBe(true);
		expect(report.migrationBreadth.pages).toHaveLength(2);
		expect(report.migrationBreadth.tabBarPageCount).toBe(4);
		expect(report.migrationBreadth.interactionAudit.pageCount).toBe(40);
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
		expect(report.contractIntake).toMatchObject({
			laneCount: 3,
			coveredFeatureKeyCount: 23,
			duplicatedFeatureKeys: [],
			uncoveredFeatureKeys: [],
			businessReady: false,
			passed: true,
		});
		expect(report.contractIntake.lanes).toMatchObject([
			{
				batchId: "C-clinical-readonly-contracts",
				status: "awaiting-formal-contract",
				gateCount: 4,
				businessReady: false,
			},
			{
				batchId: "D-patient-and-convenience-write",
				status: "awaiting-formal-contract",
				gateCount: 11,
				businessReady: false,
			},
			{
				batchId: "E-external-entry",
				status: "awaiting-formal-contract",
				gateCount: 8,
				businessReady: false,
			},
		]);
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
		/**
		 * pending/live 是有意并存的发布状态：pending 存在且来源不同，说明
		 * 候选尚未原子发布，必须明确要求发布；pending 被发布器清理后，才
		 * 回退到 live 与当前源码来源的对齐检查。测试不能把某一个窗口的
		 * 具体 hash 写死成“已发布”，否则会掩盖运行包漂移。
		 */
		if (report.runtime.pending) {
			expect(report.runtime.candidateRuntimeAligned).toBe(
				report.runtime.live?.sourceRevision ===
					report.runtime.pending.sourceRevision,
			);
			expect(report.runtime.publicationRequired).toBe(
				report.runtime.live?.sourceRevision !==
					report.runtime.pending.sourceRevision,
			);
			expect(report.runtime.expectedSourceRevision).toBe(
				report.runtime.pending.sourceRevision,
			);
		} else {
			expect(report.runtime.candidateRuntimeAligned).toBe(true);
			expect(report.runtime.publicationRequired).toBe(false);
			expect(report.runtime.expectedSourceRevision).toBe(
				report.runtime.live?.sourceRevision,
			);
		}
		expect(report.deviceEvidence.domainCount).toBe(9);
		expect(report.deviceEvidence.allPending).toBe(true);
		expect(report.deviceEvidence.passed).toBe(false);
		expect(report.deviceEvidence.candidateMatchesCurrentRuntime).toBe(true);
		expect(report.deviceEvidence.activeRuntime).toBe(
			report.runtime.pending ? "pending" : "live",
		);
		expect(report.deviceEvidence.manifestPath).toBe(
			`docs/release/device-evidence-${report.deviceEvidence.candidate.miniProgramCommit}-pending.json`,
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
		expect(report.migrationQueue[3].blockedPageCount).toBe(0);
		expect(report.migrationQueue[4].blockedPageCount).toBe(0);
		expect(report.migrationQueue[5].blockedPageCount).toBe(7);
		expect(report.migrationQueue[0].frozenGateCount).toBe(4);
		expect(report.migrationQueue[2].frozenGateCount).toBe(4);
		expect(report.migrationQueue[2]).toMatchObject({
			contractIntakeStatus: "awaiting-formal-contract",
			contractBusinessReady: false,
			contractRequiredEvidenceCount: 6,
			contractImplementationStepCount: 7,
		});
		expect(report.migrationQueue[3].frozenGateCount).toBe(11);
		expect(report.migrationQueue[3]).toMatchObject({
			contractIntakeStatus: "awaiting-formal-contract",
			contractBusinessReady: false,
			contractRequiredEvidenceCount: 6,
			contractImplementationStepCount: 8,
		});
		expect(report.migrationQueue[4].frozenGateCount).toBe(8);
		expect(report.migrationQueue[4]).toMatchObject({
			contractIntakeStatus: "awaiting-formal-contract",
			contractBusinessReady: false,
			contractRequiredEvidenceCount: 6,
			contractImplementationStepCount: 6,
		});
		expect(report.migrationQueue[5].frozenGateCount).toBe(7);
		expect(report.businessCompletion.codeReadyDomainCount).toBe(5);
		expect(report.businessCompletion.realEvidenceReadyDomainCount).toBe(0);
		expect(report.businessCompletion.passed).toBe(false);
		expect(report.structuralAuditPassed).toBe(true);
	});
});
