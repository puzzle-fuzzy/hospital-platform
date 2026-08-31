import { describe, expect, test } from "bun:test";
import { buildMigrationReadinessReport } from "./migration-readiness-report.mjs";

describe("全项目迁移 readiness 报告", () => {
	// 报告会扫描旧端台账、38 个原生页面、迁移合同和 pending/live 运行包；
	// Windows 下单独执行已经超过 Bun 默认 5 秒，但这不是放宽业务断言。
	test("区分入口结构完成、运行包发布和真实业务完成", {
		timeout: 30_000,
	}, async () => {
		const report = await buildMigrationReadinessReport(
			process.cwd(),
			"2026-08-25T00:00:00.000Z",
		);

		expect(report.entryCoverage.legacy.legacyPageCount).toBe(64);
		expect(report.entryCoverage.nativePageCount).toBe(38);
		expect(report.entryCoverage.legacy.blockedPageCount).toBe(9);
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
		).toMatchObject({ pageCount: 34, blockedPageCount: 6 });
		expect(
			report.entryCoverage.legacy.domainCoverage.find(
				(domain) => domain.domain === "健康",
			),
		).toMatchObject({ stage: "并行补齐 contract" });
		expect(
			report.entryCoverage.legacy.domainCoverage.find(
				(domain) => domain.domain === "首页",
			),
		).toMatchObject({
			pageCount: 2,
			blockedPageCount: 0,
			stage: "进入真实验收",
		});
		expect(
			report.entryCoverage.legacy.domainCoverage.find(
				(domain) => domain.domain === "患者",
			),
		).toMatchObject({ stage: "入口已覆盖，能力待契约/证据" });
		expect(
			report.entryCoverage.legacy.domainCoverage.find(
				(domain) => domain.domain === "互联网医院",
			),
		).toMatchObject({ stage: "入口已覆盖，能力待契约/证据" });
		expect(report.entryCoverage.passed).toBe(true);
		expect(report.migrationBreadth.passed).toBe(true);
		expect(report.migrationBreadth.pages).toHaveLength(2);
		expect(report.migrationBreadth.tabBarPageCount).toBe(4);
		expect(report.migrationBreadth.interactionAudit.pageCount).toBe(38);
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
		 * 运行包是否当前候选只由完整 sourceRevision 决定。旧 pending 与当前
		 * 源码不一致时，不能继续读取旧九域清单，也不能把它当作待发布候选。
		 */
		expect(report.runtime.expectedSourceRevision).toMatch(/^[0-9a-f]{40}$/u);
		expect(report.runtime.pendingMatchesExpected).toBe(
			report.runtime.pending?.sourceRevision ===
				report.runtime.expectedSourceRevision,
		);
		expect(report.runtime.liveMatchesExpected).toBe(
			report.runtime.live?.sourceRevision ===
				report.runtime.expectedSourceRevision,
		);
		expect(report.runtime.stalePending).toBe(
			Boolean(report.runtime.pending && !report.runtime.pendingMatchesExpected),
		);
		expect(report.runtime.candidateRuntimeAligned).toBe(
			report.runtime.pendingMatchesExpected ||
				report.runtime.liveMatchesExpected,
		);
		expect(report.runtime.publicationRequired).toBe(
			!report.runtime.liveMatchesExpected,
		);
		const expectedActiveRuntime = report.runtime.pendingMatchesExpected
			? "pending"
			: report.runtime.liveMatchesExpected
				? "live"
				: null;
		expect(report.deviceEvidence.activeRuntime).toBe(expectedActiveRuntime);
		expect(report.deviceEvidence.domainCount).toBe(
			report.deviceEvidence.present ? 9 : 0,
		);
		expect(report.deviceEvidence.allPending).toBe(
			report.deviceEvidence.present,
		);
		expect(report.deviceEvidence.passed).toBe(false);
		expect(report.deviceEvidence.candidateMatchesCurrentRuntime).toBe(
			report.deviceEvidence.present,
		);
		if (report.deviceEvidence.present) {
			const evidenceManifest = await Bun.file(
				report.deviceEvidence.manifestPath,
			).json();
			// 清单文件名的短前缀历史上有 7/8 位等不同写法，不能把文件名
			// 当作候选身份；真正的绑定依据是清单内部的完整 sourceRevision。
			expect(evidenceManifest.candidate.sourceRevision).toBe(
				report.deviceEvidence.candidate.sourceRevision,
			);
		} else {
			expect(report.deviceEvidence.candidate).toBeNull();
		}
		/**
		 * 交接单里的可复制命令必须和 readiness 实际选择的证据清单一致；
		 * 否则新会话可能把真机结果写入历史候选，造成页面、客户端和服务端
		 * 证据看似齐全但来源无法配对。这里不硬编码提交号，候选轮换时由
		 * 当前 live/pending 运行包自动决定应检查的清单路径。
		 */
		const handoff = await Bun.file(
			"docs/migration/full-migration-handoff-2026-08-25.md",
		).text();
		if (report.deviceEvidence.present) {
			expect(handoff).toContain(
				`pnpm device:evidence:audit --file ${report.deviceEvidence.manifestPath}`,
			);
		}
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
		expect(report.migrationQueue[4].blockedPageCount).toBe(1);
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
