import { describe, expect, test } from "bun:test";
import { auditMiniprogramNavigation } from "./miniprogram-navigation-audit.mjs";

describe("小程序页面落点与主 Tab 导航门禁", () => {
	test("当前原生页面、底栏资源和固定导航调用全部闭环", async () => {
		const result = await auditMiniprogramNavigation();

		expect(result.registeredPageCount).toBe(21);
		expect(result.tabBarPageCount).toBe(4);
		expect(result.pageFileChecks.every((check) => check.exists)).toBe(true);
		expect(result.failures).toEqual([]);
		expect(result.passed).toBe(true);
	});
});
