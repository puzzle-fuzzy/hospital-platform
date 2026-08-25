import { describe, expect, test } from "bun:test";
import { FEATURE_STATUS_CATALOG } from "./feature-navigation";
import {
	getFeatureMigrationCoverage,
	getLegacyPageMigrationBatch,
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

	test("所有状态入口都进入明确的 A-F 迁移批次", () => {
		for (const featureKey of Object.keys(FEATURE_STATUS_CATALOG) as Array<
			keyof typeof FEATURE_STATUS_CATALOG
		>) {
			const coverage = getFeatureMigrationCoverage(featureKey);
			expect(coverage.migrationBatch.id).toMatch(/^[A-F]-/u);
			expect(coverage.migrationBatch.label.length).toBeGreaterThan(0);
			expect(coverage.migrationBatch.nextInput.length).toBeGreaterThan(0);
			expect(coverage.contractFamily).toBeTruthy();
			expect(coverage.contractFamilyLabel.length).toBeGreaterThan(0);
		}
	});

	test("契约族和迁移批次保持独立，避免把不同风险入口混为一谈", () => {
		const patientQr = getFeatureMigrationCoverage("patient-qr");
		const cloudImage = getFeatureMigrationCoverage("report-cloud-image");
		const insurance = getFeatureMigrationCoverage("insurance");

		expect(patientQr.migrationBatch.id).toBe("D-patient-and-convenience-write");
		expect(patientQr.contractFamily).toBe("patient-write");
		expect(cloudImage.migrationBatch.id).toBe("E-external-entry");
		expect(cloudImage.contractFamily).toBe("provider-read-only");
		expect(insurance.migrationBatch.id).toBe("F-payment-and-writeback");
		expect(insurance.contractFamily).toBe("payment-write");
	});

	test("健康内容和支付入口不会混入同一迁移批次", () => {
		expect(
			getFeatureMigrationCoverage("health-encyclopedia").migrationBatch.id,
		).toBe("B-health-content");
		expect(getFeatureMigrationCoverage("insurance").migrationBatch.id).toBe(
			"F-payment-and-writeback",
		);
	});

	test("64 个旧入口都归入明确批次或显式排除", () => {
		const batches = new Map<string, number>();
		for (const entry of LEGACY_PAGE_MIGRATION_CATALOG) {
			const batch = getLegacyPageMigrationBatch(entry);
			batches.set(batch, (batches.get(batch) ?? 0) + 1);
		}

		expect([...batches.keys()].sort()).toEqual([
			"A-readonly-evidence",
			"B-health-content",
			"C-clinical-readonly-contracts",
			"D-patient-and-convenience-write",
			"E-external-entry",
			"F-payment-and-writeback",
			"excluded",
		]);
		expect([...batches.values()].reduce((sum, count) => sum + count, 0)).toBe(
			LEGACY_PAGE_MIGRATION_CATALOG.length,
		);
	});

	test("没有 featureKey 的健康内容页面进入 B，互联网医院壳进入 E", () => {
		const healthContent = LEGACY_PAGE_MIGRATION_CATALOG.find(
			(entry) => entry.legacyPath === "pagesB/health/health_encyclopedia.vue",
		);
		const internetHospital = LEGACY_PAGE_MIGRATION_CATALOG.find(
			(entry) => entry.legacyPath === "pages/hospital/hospital.vue",
		);

		expect(healthContent).toBeDefined();
		expect(internetHospital).toBeDefined();
		if (!healthContent || !internetHospital) throw new Error("测试台账缺失");
		expect(getLegacyPageMigrationBatch(healthContent)).toBe("B-health-content");
		expect(getLegacyPageMigrationBatch(internetHospital)).toBe(
			"E-external-entry",
		);
	});
});
