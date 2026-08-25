import { describe, expect, test } from "bun:test";
import { FROZEN_DOMAIN_GATE_CATALOG } from "./migration-boundary-catalog.mjs";

const REQUIRED_SEMANTIC_STATES = [
	"requesting",
	"success-non-empty",
	"success-empty",
	"unauthorized",
	"invalid-input",
	"temporary-failure",
	"contract-invalid",
];

const REQUIRED_COMMON_MATERIALS = [
	"request",
	"response",
	"success-empty",
	"rejected",
	"timeout",
	"owner-mapping",
	"field-allowlist",
	"redaction",
	"logging",
	"rollback",
];

describe("全量阻断业务域准入目录", () => {
	test("14 个冻结域都有唯一身份和旧页面落点", () => {
		expect(FROZEN_DOMAIN_GATE_CATALOG).toHaveLength(14);
		expect(
			new Set(FROZEN_DOMAIN_GATE_CATALOG.map((gate) => gate.id)).size,
		).toBe(14);
		for (const gate of FROZEN_DOMAIN_GATE_CATALOG) {
			expect(gate.name.length).toBeGreaterThan(0);
			expect(gate.featureKey.length).toBeGreaterThan(0);
			expect(gate.readiness.length).toBeGreaterThan(0);
			expect(gate.contractFamily.length).toBeGreaterThan(0);
			expect(gate.legacyPaths.length).toBeGreaterThan(0);
		}
	});

	test("每个冻结域都声明完整的语义、通用材料和关闭能力", () => {
		for (const gate of FROZEN_DOMAIN_GATE_CATALOG) {
			expect(gate.semanticStates).toEqual(
				expect.arrayContaining(REQUIRED_SEMANTIC_STATES),
			);
			expect(gate.commonMaterials).toEqual(
				expect.arrayContaining(REQUIRED_COMMON_MATERIALS),
			);
			expect(gate.requiredMaterials.length).toBeGreaterThan(0);
			expect(gate.forbiddenCapabilities.length).toBeGreaterThan(0);
		}
	});

	test("支付、患者写入、外部会话和临床内容保持独立 contract 家族", () => {
		expect(
			FROZEN_DOMAIN_GATE_CATALOG.find((gate) => gate.id === "inpatient-payment")
				?.contractFamily,
		).toBe("payment-write");
		expect(
			FROZEN_DOMAIN_GATE_CATALOG.find((gate) => gate.id === "patient-binding")
				?.contractFamily,
		).toBe("patient-write");
		expect(
			FROZEN_DOMAIN_GATE_CATALOG.find((gate) => gate.id === "consultation")
				?.contractFamily,
		).toBe("external-session");
		expect(
			FROZEN_DOMAIN_GATE_CATALOG.find((gate) => gate.id === "health-test")
				?.contractFamily,
		).toBe("clinical-content-write");
	});
});
