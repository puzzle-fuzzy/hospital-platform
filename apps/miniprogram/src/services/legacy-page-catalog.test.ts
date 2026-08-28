import { describe, expect, test } from "bun:test";
import {
	FEATURE_STATUS_CATALOG,
	resolveFeatureStatus,
} from "./feature-navigation";
import {
	isKnownLegacyFeatureKey,
	LEGACY_PAGE_COUNT,
	LEGACY_PAGE_DOMAIN_SUMMARY,
	LEGACY_PAGE_MIGRATION_CATALOG,
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
			// 所有 blocked 页面都代表 contract 尚未冻结的真实入口，必须
			// 进入统一状态页；不能只给当前重点域加门禁，遗漏其它旧入口。
			if (entry.status.startsWith("blocked-")) {
				expect(entry.nativeTarget).toBe("pages/feature-status/feature-status");
				expect(isKnownLegacyFeatureKey(entry.featureKey)).toBe(true);
			}
			expect(nativePages.has(entry.nativeTarget ?? "")).toBe(true);
			if (entry.nativeTarget === "pages/feature-status/feature-status") {
				expect(isKnownLegacyFeatureKey(entry.featureKey)).toBe(true);
				expect(
					entry.featureKey && FEATURE_STATUS_CATALOG[entry.featureKey],
				).toBeTruthy();
			} else {
				// 安全只读页可以保留未来 contract 的关联 key；只有当前
				// 没有任何契约关联的普通静态/只读页才必须没有 key。
				if (entry.featureKey) {
					expect(["replaced", "partial", "surface-only"]).toContain(
						entry.status,
					);
					expect(FEATURE_STATUS_CATALOG[entry.featureKey]).toBeTruthy();
				}
			}
		}
	});

	test("台账引用的状态页 key 都存在于统一目录", () => {
		for (const entry of LEGACY_PAGE_MIGRATION_CATALOG) {
			if (!entry.featureKey) continue;
			expect(FEATURE_STATUS_CATALOG[entry.featureKey]).toBeTruthy();
		}
	});

	test("统一状态页目录的图标资源都存在", async () => {
		for (const [featureKey, feature] of Object.entries(
			FEATURE_STATUS_CATALOG,
		)) {
			const assetPath = feature.icon.replace(/^\/+/, "");
			// 状态页图标来自小程序本地 assets；这里只校验仓库资源存在，
			// 不把网络 URL 或旧端第三方图片地址带入迁移运行包。
			expect(assetPath.startsWith("assets/")).toBe(true);
			expect(
				await Bun.file(new URL(`../${assetPath}`, import.meta.url)).exists(),
			).toBe(true);
			expect(featureKey.length).toBeGreaterThan(0);
		}
	});

	test("非法状态页参数不会伪装成具体业务", () => {
		expect(resolveFeatureStatus("medical-record")).toMatchObject({
			featureKey: "medical-record",
			feature: { title: "门诊病历" },
		});
		expect(resolveFeatureStatus("expired-feature")).toMatchObject({
			featureKey: "invalid-entry",
			feature: {
				title: "服务入口不可用",
				readiness: "入口校验失败",
			},
		});
	});

	test("互联网医院旧入口只迁移安全壳，不伪造外部业务完成", async () => {
		const entry = LEGACY_PAGE_MIGRATION_CATALOG.find(
			(item) => item.legacyPath === "pages/hospital/hospital.vue",
		);
		expect(entry).toMatchObject({
			status: "partial",
			nativeTarget: "pages/hospital/hospital",
		});
		expect(entry?.featureKey).toBeUndefined();

		const pageWxml = await Bun.file(
			new URL("../pages/hospital/hospital.wxml", import.meta.url),
		).text();
		// 主 Tab 的安全壳只说明 contract 尚未完成；真正的 web-view 和外部
		// URL 必须等 audience、allowlist、短期会话和回跳证据齐全后再加入。
		expect(pageWxml).not.toContain("<web-view");
		expect(pageWxml).toContain("互联网医院服务正在完善中");
	});

	test("每个旧业务域都有可追溯的状态分布，且总量与逐页台账一致", () => {
		expect(LEGACY_PAGE_DOMAIN_SUMMARY).toHaveLength(7);
		expect(
			LEGACY_PAGE_DOMAIN_SUMMARY.reduce(
				(total, summary) => total + summary.total,
				0,
			),
		).toBe(LEGACY_PAGE_COUNT);

		for (const summary of LEGACY_PAGE_DOMAIN_SUMMARY) {
			const entries = LEGACY_PAGE_MIGRATION_CATALOG.filter(
				(entry) => entry.domain === summary.domain,
			);
			expect(summary.total).toBe(entries.length);
			for (const [status, count] of Object.entries(summary.byStatus)) {
				expect(entries.filter((entry) => entry.status === status).length).toBe(
					count,
				);
			}
		}
	});
});
