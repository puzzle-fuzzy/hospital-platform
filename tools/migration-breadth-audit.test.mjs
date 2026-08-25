import { describe, expect, test } from "bun:test";
import {
	auditMigrationBreadth,
	auditPageInteractionSource,
} from "./migration-breadth-audit.mjs";

describe("跨业务域入口广度审计", () => {
	test("首页和我的所有可见入口都有固定分发，状态 key 可追溯", async () => {
		const result = await auditMigrationBreadth();

		expect(result.passed).toBe(true);
		expect(result.failures).toEqual([]);
		expect(result.pages.map((page) => page.id)).toEqual(["首页", "我的"]);
		expect(result.pages.every((page) => page.missingCases.length === 0)).toBe(
			true,
		);
		expect(
			result.pages.every((page) => page.unknownFeatureKeys.length === 0),
		).toBe(true);
		expect(result.tabBarPageCount).toBe(4);
		expect(result.featureStatusActions).toHaveLength(14);
		expect(result.featureStatusActions).toContain("首页:patient-qr");
		expect(result.featureStatusActions).toContain(
			"门诊费用:outpatient-payment-write",
		);
		expect(result.interactionAudit.pageCount).toBe(40);
		expect(result.interactionAudit.failures).toEqual([]);
		expect(result.interactionAudit.pages.every((page) => page.passed)).toBe(
			true,
		);
	});

	test("WXML 事件缺少页面方法时必须被发现", () => {
		const result = auditPageInteractionSource(
			'<view bindtap="onRetry"></view><input bindinput="onInput" />',
			"Page({\n\tonRetry() {}\n})",
		);

		expect(result.handlers).toEqual(["onRetry", "onInput"]);
		expect(result.missingHandlers).toEqual(["onInput"]);
		expect(result.passed).toBe(false);
	});
});
