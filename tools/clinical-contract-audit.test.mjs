import { describe, expect, test } from "bun:test";
import { buildClinicalContractAudit } from "./clinical-contract-audit.mjs";

describe("临床四域合同门禁", () => {
	test("四个临床域保持独立、未注册且没有误加 API 路由", async () => {
		const report = await buildClinicalContractAudit(process.cwd());

		expect(report.domainCount).toBe(4);
		expect(report.intakeStatus).toBe("normalized");
		expect(report.structuredGate.status).toBe("normalized");
		expect(report.structuredGate.domains).toHaveLength(4);
		expect(report.structuredGate.domains.map((domain) => domain.id)).toEqual(
			expect.arrayContaining([
				"outpatient-records",
				"inpatient",
				"doctor-relationship",
				"electronic-consultation",
			]),
		);
		expect(
			report.structuredGate.domains.map((domain) => domain.id),
		).not.toContain("consultation");
		expect(
			report.structuredGate.domains.every(
				(domain) => domain.contractStatus === "pending",
			),
		).toBe(true);
		expect(report.structuredGate.passed).toBe(true);
		expect(report.domains.every((domain) => domain.passed)).toBe(true);
		expect(report.forbiddenRuntimeEntries).toEqual([]);
		expect(report.passed).toBe(true);
	});
});
