import { describe, expect, test } from "bun:test";
import { READ_ONLY_DOMAIN_CATALOG } from "./read-only-domain-catalog.mjs";
import { auditReadOnlyDomains } from "./read-only-domain-audit.mjs";

describe("只读业务域闭环清单", () => {
	test("五个已开放只读域都有唯一 id 和中文边界说明", () => {
		expect(READ_ONLY_DOMAIN_CATALOG).toHaveLength(5);
		expect(
			new Set(READ_ONLY_DOMAIN_CATALOG.map((domain) => domain.id)).size,
		).toBe(5);
		for (const domain of READ_ONLY_DOMAIN_CATALOG) {
			expect(domain.name.length).toBeGreaterThan(0);
			expect(domain.boundary).toContain("；");
		}
	});

	test("仓库当前的页面、API、实现、日志和文档闭环通过", async () => {
		const result = await auditReadOnlyDomains();
		expect(result.failures).toEqual([]);
		expect(result.pageCount).toBeGreaterThanOrEqual(8);
		expect(result.routeCount).toBe(8);
	});
});
