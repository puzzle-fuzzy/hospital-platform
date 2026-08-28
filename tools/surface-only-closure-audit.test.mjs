import { describe, expect, test } from "bun:test";
import {
	auditSurfaceOnlyClosure,
	inspectForbiddenCalls,
	stripCommentsAndStrings,
} from "./surface-only-closure-audit.mjs";

describe("未开放页面关闭态审计", () => {
	test("台账中的 surface-only 入口全部绑定到安全运行时落点", async () => {
		const report = await auditSurfaceOnlyClosure();

		expect(report).toMatchObject({
			passed: true,
			catalogTargetCount: 13,
			declaredTargetCount: 13,
			factoryPageCount: 12,
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

	test("保留模板插值中的可执行表达式，避免漏掉隐藏的直连调用", () => {
		// 用拼接构造 fixture，避免测试源码自身的模板占位符被 Biome 当成
		// 未使用插值；最终传给扫描器的内容仍然是真实的 `${...}` 代码。
		const source = "const text = `$" + '{wx.request({ url: "provider" })}`;';

		expect(stripCommentsAndStrings(source)).toContain("wx.request");
	});

	test("导入路径扫描不会因字符串剥离而漏掉集中 API client", () => {
		const source = 'import { request } from "../../services/api-client";';

		expect(inspectForbiddenCalls("fixture.ts", source)).toContain(
			"fixture.ts 出现直接导入集中 API client",
		);
		expect(
			inspectForbiddenCalls(
				"fixture.ts",
				'// import { request } from "../../services/api-client";',
			),
		).toEqual([]);
	});
});
