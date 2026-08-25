import { describe, expect, test } from "bun:test";
import {
	auditMigrationContractIntake,
	MIGRATION_CONTRACT_INTAKE_CATALOG,
} from "./migration-contract-intake-catalog.mjs";

describe("C/D/E 契约材料入口", () => {
	test("覆盖全部未完成的临床、患者写入和外部入口 gate", () => {
		const report = auditMigrationContractIntake();

		expect(MIGRATION_CONTRACT_INTAKE_CATALOG).toHaveLength(3);
		expect(report).toMatchObject({
			schemaVersion: 1,
			laneCount: 3,
			coveredFeatureKeyCount: 24,
			duplicatedFeatureKeys: [],
			uncoveredFeatureKeys: [],
			businessReady: false,
			failures: [],
			passed: true,
		});
		expect(report.lanes.map((lane) => lane.gateCount)).toEqual([4, 12, 8]);
		expect(report.lanes[0].featureKeys).not.toContain("consultation");
		expect(report.lanes[2].featureKeys).toContain("consultation");
		for (const lane of report.lanes) {
			expect(lane.status).toBe("awaiting-formal-contract");
			expect(lane.requiredEvidence.length).toBeGreaterThanOrEqual(5);
			expect(lane.implementationSequence.length).toBeGreaterThanOrEqual(5);
			expect(lane.forbiddenUntilConfirmed.length).toBeGreaterThanOrEqual(3);
			expect(lane.businessReady).toBe(false);
		}
	});
});
