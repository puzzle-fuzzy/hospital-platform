import { describe, expect, test } from "bun:test";
import {
	auditMigrationContractIntake,
	buildFeatureContractIntakeRows,
	MIGRATION_CONTRACT_INTAKE_CATALOG,
} from "./migration-contract-intake-catalog.mjs";

describe("C/D/E 契约材料入口", () => {
	test("覆盖全部未完成的临床、患者写入和外部入口 gate", () => {
		const report = auditMigrationContractIntake();

		expect(MIGRATION_CONTRACT_INTAKE_CATALOG).toHaveLength(3);
		expect(report).toMatchObject({
			schemaVersion: 1,
			laneCount: 3,
			coveredFeatureKeyCount: 23,
			duplicatedFeatureKeys: [],
			uncoveredFeatureKeys: [],
			businessReady: false,
			failures: [],
			passed: true,
		});
		expect(report.lanes.map((lane) => lane.gateCount)).toEqual([4, 11, 8]);
		expect(report.featureIntakeRows).toHaveLength(23);
		expect(report.lanes[0].featureKeys).not.toContain("consultation");
		expect(report.lanes[2].featureKeys).toContain("consultation");
		expect(buildFeatureContractIntakeRows()).toEqual(report.featureIntakeRows);
		expect(
			report.featureIntakeRows.find((row) => row.featureKey === "patient-qr"),
		).toMatchObject({
			batchId: "D-patient-and-convenience-write",
			contractFamily: "patient-write",
			status: "awaiting-formal-contract",
			businessReady: false,
		});
		expect(
			report.featureIntakeRows.find((row) => row.featureKey === "patient-qr")
				.requiredMaterials,
		).toEqual(
			expect.arrayContaining([
				"signed-payload",
				"audience",
				"ttl",
				"anti-replay",
				"revocation",
			]),
		);
		for (const lane of report.lanes) {
			expect(lane.status).toBe("awaiting-formal-contract");
			expect(lane.requiredEvidence.length).toBeGreaterThanOrEqual(5);
			expect(lane.implementationSequence.length).toBeGreaterThanOrEqual(5);
			expect(lane.forbiddenUntilConfirmed.length).toBeGreaterThanOrEqual(3);
			expect(lane.businessReady).toBe(false);
		}
	});
});
