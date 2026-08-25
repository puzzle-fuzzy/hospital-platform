import { describe, expect, test } from "bun:test";
import { FEATURE_STATUS_CATALOG } from "./feature-navigation";
import {
	LEGACY_PAGE_COUNT,
	LEGACY_PAGE_MIGRATION_CATALOG,
	isKnownLegacyFeatureKey,
} from "./legacy-page-catalog";

describe("旧端页面全量迁移台账", () => {
	test("64 个旧页面都只有一个明确落点", async () => {
		expect(LEGACY_PAGE_MIGRATION_CATALOG).toHaveLength(LEGACY_PAGE_COUNT);
		const paths = LEGACY_PAGE_MIGRATION_CATALOG.map(
			(entry) => entry.legacyPath,
		);
		expect(new Set(paths).size).toBe(paths.length);
		expect(paths.every((path) => path.endsWith(".vue"))).toBe(true);

		const appConfig = await Bun.file(
			new URL("../app.json", import.meta.url),
		).json();
		const nativePages = new Set<string>([
			...(appConfig.pages as string[]),
			"pages/feature-status/feature-status",
		]);

		for (const entry of LEGACY_PAGE_MIGRATION_CATALOG) {
			expect(entry.nativeTarget).not.toBeUndefined();
			if (entry.status === "excluded") {
				expect(entry.nativeTarget).toBeNull();
				expect(entry.featureKey).toBeUndefined();
				continue;
			}
			expect(nativePages.has(entry.nativeTarget ?? "")).toBe(true);
			if (entry.nativeTarget === "pages/feature-status/feature-status") {
				expect(isKnownLegacyFeatureKey(entry.featureKey)).toBe(true);
				expect(
					entry.featureKey && FEATURE_STATUS_CATALOG[entry.featureKey],
				).toBeTruthy();
			} else {
				expect(entry.featureKey).toBeUndefined();
			}
		}
	});

	test("台账引用的状态页 key 都存在于统一目录", () => {
		for (const entry of LEGACY_PAGE_MIGRATION_CATALOG) {
			if (!entry.featureKey) continue;
			expect(FEATURE_STATUS_CATALOG[entry.featureKey]).toBeTruthy();
		}
	});
});
