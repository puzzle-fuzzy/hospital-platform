import { describe, expect, test } from "bun:test";
import { auditMigrationBreadth } from "./migration-breadth-audit.mjs";

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
	});
});
