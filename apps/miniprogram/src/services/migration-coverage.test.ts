import { describe, expect, test } from "bun:test";
import { FEATURE_STATUS_CATALOG } from "./feature-navigation";
import {
	getFeatureMigrationCoverage,
	type MigrationCoverageStage,
} from "./migration-coverage";
import { LEGACY_PAGE_MIGRATION_CATALOG } from "./legacy-page-catalog";

describe("迁移入口覆盖聚合", () => {
	test("台账中的每个 feature key 都能生成稳定覆盖信息", () => {
		for (const entry of LEGACY_PAGE_MIGRATION_CATALOG) {
			if (!entry.featureKey) continue;
			const coverage = getFeatureMigrationCoverage(entry.featureKey);
			expect(coverage.featureKey).toBe(entry.featureKey);
			expect(coverage.legacyPaths).toContain(entry.legacyPath);
			expect(coverage.nativeTarget.length).toBeGreaterThan(0);
			expect(coverage.nextStep.length).toBeGreaterThan(0);
		}
	});

	test("没有旧端页面的新增入口不会被误报为旧页面已替换", () => {
		const coverage = getFeatureMigrationCoverage("patient-qr");
		expect(coverage.stage).toBe("new-entry");
		expect(coverage.legacyPaths).toHaveLength(0);
		expect(coverage.coverageLabel).toContain("新端新增入口");
	});

	test("健康自测保留临床阻塞，不因多个旧入口共用 key 而误开放", () => {
		const coverage = getFeatureMigrationCoverage("health-test");
		expect(coverage.stage as MigrationCoverageStage).toBe("blocked-clinical");
		expect(coverage.stageLabel).toBe("等待临床审核");
		expect(coverage.nextStep).toContain("临床审核");
	});

	test("电子锦旗覆盖视图保留全部旧端入口和临床阻塞语义", () => {
		const coverage = getFeatureMigrationCoverage("gift-banner");
		expect(coverage.stage as MigrationCoverageStage).toBe("blocked-clinical");
		expect(coverage.legacyPaths).toHaveLength(3);
		expect(coverage.domains).toEqual(["健康"]);
		expect(coverage.nextStep).toContain("临床审核");
	});

	test("所有状态目录 key 都能被页面安全解析", () => {
		const featureKeys = Object.keys(FEATURE_STATUS_CATALOG) as Array<
			keyof typeof FEATURE_STATUS_CATALOG
		>;
		for (const featureKey of featureKeys) {
			const coverage = getFeatureMigrationCoverage(featureKey);
			expect(coverage.feature.title).toBe(
				FEATURE_STATUS_CATALOG[featureKey].title,
			);
			expect(coverage.stageLabel.length).toBeGreaterThan(0);
		}
	});
});
