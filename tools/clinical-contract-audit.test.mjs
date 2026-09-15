import { describe, expect, test } from "bun:test";
import { buildClinicalContractAudit } from "./clinical-contract-audit.mjs";

describe("临床三域合同门禁", () => {
	test("门诊摘要以关闭闸门注册，其余临床域保持独立未注册", async () => {
		const report = await buildClinicalContractAudit(process.cwd());

		expect(report.domainCount).toBe(3);
		expect(report.intakeStatus).toBe("normalized");
		expect(report.structuredGate.status).toBe("normalized");
		expect(report.structuredGate.domains).toHaveLength(3);
		expect(report.structuredGate.domains.map((domain) => domain.id)).toEqual(
			expect.arrayContaining([
				"outpatient-records",
				"inpatient",
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
		expect(
			report.structuredGate.domains.find(
				(domain) => domain.id === "outpatient-records",
			)?.implementationStatus,
		).toBe("registered-fail-closed");
		expect(report.structuredGate.passed).toBe(true);
		expect(report.domains.every((domain) => domain.passed)).toBe(true);
		expect(report.forbiddenRuntimeEntries).toEqual([]);
		expect(report.passed).toBe(true);
	});
});
