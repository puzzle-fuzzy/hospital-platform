import { describe, expect, test } from "bun:test";
import {
	FEATURE_STATUS_CATALOG,
	getFeatureUserFacingCopy,
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

	test("互联网医院旧入口恢复为固定 H5 WebView，不开放任意外部地址", async () => {
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
		expect(pageWxml).toContain('<web-view class="internet-hospital-webview"');
		expect(pageWxml).toContain('src="{{webViewUrl}}"');
		const pageScript = await Bun.file(
			new URL("../pages/hospital/hospital.ts", import.meta.url),
		).text();
		expect(pageScript).toContain("INTERNET_HOSPITAL_BASE_URL");
		expect(pageScript).toContain("https://cx.o2o.bailingjk.net/wechat/");
		expect(pageScript).toContain("publicNoCode=gzh-048400_0001");
		expect(pageScript).not.toContain("decodeURIComponent");
		expect(pageScript).not.toContain("system/auth/ticket");
		expect(pageScript).not.toContain("navigateToMiniProgram");
	});

	test("智能客服旧入口恢复为固定 H5 WebView，不恢复通用动态入口", async () => {
		const entry = LEGACY_PAGE_MIGRATION_CATALOG.find(
			(item) => item.legacyPath === "pagesB/health/webview.vue",
		);
		expect(entry).toMatchObject({
			status: "partial",
			nativeTarget: "pages/smart-customer/smart-customer",
			featureKey: "smart-customer",
		});

		const pageWxml = await Bun.file(
			new URL("../pages/smart-customer/smart-customer.wxml", import.meta.url),
		).text();
		expect(pageWxml).toContain('<web-view class="smart-customer-webview"');
		expect(pageWxml).toContain('src="{{webViewUrl}}"');
		const pageScript = await Bun.file(
			new URL("../pages/smart-customer/smart-customer.ts", import.meta.url),
		).text();
		expect(pageScript).toContain("SMART_CUSTOMER_BASE_URL");
		expect(pageScript).toContain("https://html.ydrj.top");
		expect(pageScript).not.toContain("system/auth/ticket");
		expect(pageScript).not.toContain("decodeURIComponent");
		expect(pageScript).not.toContain("fullUrl");
	});

	test("我的医保电子凭证入口恢复为旧端固定小程序跳转", async () => {
		const app = await Bun.file(new URL("../app.json", import.meta.url)).text();
		const pageScript = await Bun.file(
			new URL("../pages/my/my.ts", import.meta.url),
		).text();
		const navigation = await Bun.file(
			new URL("./insurance-voucher-navigation.ts", import.meta.url),
		).text();

		expect(app).toContain('"navigateToMiniProgramAppIdList"');
		expect(app).toContain('"wx81ce904580cc0ff1"');
		expect(pageScript).toContain("navigateToInsuranceVoucher");
		expect(pageScript).not.toContain('navigateToFeatureStatus("insurance")');
		expect(navigation).toContain("wx.navigateToMiniProgram({");
		expect(navigation).toContain(
			'INSURANCE_VOUCHER_APP_ID = "wx81ce904580cc0ff1"',
		);
		expect(navigation).toContain('path: ""');
		expect(navigation).toContain("extraData: {}");
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

	test("我的问诊不把旧端硬编码演示数据误标为外部真实会话", () => {
		const consultation = FEATURE_STATUS_CATALOG.consultation;

		expect(consultation.readiness).toBe("待外部入口 contract");
		expect(consultation.description).toContain("演示数据");
		expect(consultation.description).toContain("不会复制");
		expect(consultation.contractHint).toContain("外部主体");
		expect(consultation.contractHint).toContain("短期会话");
	});

	test("状态页面按业务分类提供用户文案，不泄漏内部门禁术语", () => {
		const providerCopy = getFeatureUserFacingCopy(
			FEATURE_STATUS_CATALOG["medical-record"],
		);
		const paymentCopy = getFeatureUserFacingCopy(
			FEATURE_STATUS_CATALOG.insurance,
		);
		const clinicalCopy = getFeatureUserFacingCopy(
			FEATURE_STATUS_CATALOG["health-test"],
		);

		// Provider、支付和临床审核必须让用户看到不同的原因，不能再统一
		// 显示“外部服务不可用”或“功能正在完善”。
		expect(providerCopy.badge).toBe("数据服务接入中");
		expect(paymentCopy.badge).toBe("支付服务准备中");
		expect(clinicalCopy.badge).toBe("专业内容审核中");
		expect(
			new Set([providerCopy.badge, paymentCopy.badge, clinicalCopy.badge]).size,
		).toBe(3);

		// 这些文案会进入 WXML，不能把迁移台账里的内部分类带给普通用户。
		for (const copy of [providerCopy, paymentCopy, clinicalCopy]) {
			expect(copy.description).not.toContain("provider");
			expect(copy.description).not.toContain("contract");
			expect(copy.progress).not.toContain("provider");
			expect(copy.progress).not.toContain("contract");
		}
	});
});
