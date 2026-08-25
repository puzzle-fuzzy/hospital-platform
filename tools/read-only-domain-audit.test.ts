import { describe, expect, test } from "bun:test";
import { READ_ONLY_DOMAIN_CATALOG } from "./read-only-domain-catalog.mjs";
import { auditReadOnlyDomains } from "./read-only-domain-audit.mjs";

describe("低风险业务域闭环清单", () => {
	test("五个已开放域都有唯一 id、操作边界和中文说明", () => {
		expect(READ_ONLY_DOMAIN_CATALOG).toHaveLength(5);
		expect(
			new Set(READ_ONLY_DOMAIN_CATALOG.map((domain) => domain.id)).size,
		).toBe(5);
		for (const domain of READ_ONLY_DOMAIN_CATALOG) {
			expect(domain.name.length).toBeGreaterThan(0);
			expect(domain.boundary).toContain("；");
			expect(["read-only", "read-model-sync", "read-write"]).toContain(
				domain.operationClass,
			);
		}
		expect(
			READ_ONLY_DOMAIN_CATALOG.find((domain) => domain.id === "patients")
				?.operationClass,
		).toBe("read-model-sync");
		expect(
			READ_ONLY_DOMAIN_CATALOG.find((domain) => domain.id === "user-profile")
				?.operationClass,
		).toBe("read-write");
		const profileLogEvents = READ_ONLY_DOMAIN_CATALOG.find(
			(domain) => domain.id === "user-profile",
		)?.logEvents;
		expect(profileLogEvents).toEqual(
			expect.arrayContaining([
				"user.profile.update.requested",
				"user.profile.updated",
				"user.profile.conflict",
				"user.profile.update_failed",
			]),
		);
	});

	test("仓库当前的页面、API、实现、日志和文档闭环通过", async () => {
		const result = await auditReadOnlyDomains();
		expect(result.failures).toEqual([]);
		expect(result.pageCount).toBeGreaterThanOrEqual(8);
		expect(result.routeCount).toBe(10);
	});
});
