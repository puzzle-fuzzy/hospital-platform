import { describe, expect, test } from "bun:test";
import {
	auditSurfaceOnlyClosure,
	stripCommentsAndStrings,
} from "./surface-only-closure-audit.mjs";

describe("未开放页面关闭态审计", () => {
	test("台账中的 surface-only 入口全部绑定到安全运行时落点", async () => {
		const report = await auditSurfaceOnlyClosure();

		expect(report).toMatchObject({
			passed: true,
			catalogTargetCount: 15,
			declaredTargetCount: 15,
			factoryPageCount: 14,
			localSubsetPageCount: 1,
			sharedSourceCount: 6,
			failures: [],
		});
		expect(report.checked.every((page) => page.passed)).toBe(true);
	});

	test("只扫描可执行调用，不把关闭态注释误判成网络旁路", () => {
		const source = `
			// wx.request({ url: "provider" });
			const copy = "wx.requestPayment({})";
			return wx.navigateTo({ url: "/pages/feature-status/feature-status" });
		`;

		expect(stripCommentsAndStrings(source)).not.toContain("wx.request(");
		expect(stripCommentsAndStrings(source)).toContain("wx.navigateTo");
	});
});
