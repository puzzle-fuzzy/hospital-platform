import { describe, expect, test } from "bun:test";
import {
	FROZEN_DOMAIN_GATE_CATALOG,
	MIGRATION_BATCH_IDS,
} from "./migration-boundary-catalog.mjs";

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
	test("34 个冻结入口都有唯一身份和页面或 action-only 入口来源", () => {
		expect(FROZEN_DOMAIN_GATE_CATALOG).toHaveLength(34);
		expect(
			new Set(FROZEN_DOMAIN_GATE_CATALOG.map((gate) => gate.id)).size,
		).toBe(34);
		for (const gate of FROZEN_DOMAIN_GATE_CATALOG) {
			expect(gate.name.length).toBeGreaterThan(0);
			expect(gate.featureKey.length).toBeGreaterThan(0);
			expect(gate.readiness.length).toBeGreaterThan(0);
			expect(gate.contractFamily.length).toBeGreaterThan(0);
			expect(MIGRATION_BATCH_IDS).toContain(gate.migrationBatch);
			expect(
				gate.legacyPaths.length + (gate.legacyActions?.length ?? 0),
			).toBeGreaterThan(0);
		}
		expect(
			new Set(FROZEN_DOMAIN_GATE_CATALOG.map((gate) => gate.migrationBatch))
				.size,
		).toBe(5);
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
			FROZEN_DOMAIN_GATE_CATALOG.find((gate) => gate.id === "consultation")
				?.migrationBatch,
		).toBe("E-external-entry");
		expect(
			FROZEN_DOMAIN_GATE_CATALOG.find(
				(gate) => gate.id === "electronic-consultation",
			)?.migrationBatch,
		).toBe("C-clinical-readonly-contracts");
		expect(
			FROZEN_DOMAIN_GATE_CATALOG.find((gate) => gate.id === "health-test")
				?.contractFamily,
		).toBe("clinical-content-write");
		expect(
			FROZEN_DOMAIN_GATE_CATALOG.find((gate) => gate.id === "gift-banner")
				?.readiness,
		).toBe("待临床审核");
		expect(
			FROZEN_DOMAIN_GATE_CATALOG.find((gate) => gate.id === "insurance")
				?.contractFamily,
		).toBe("payment-write");
		expect(
			FROZEN_DOMAIN_GATE_CATALOG.find((gate) => gate.id === "smart-guide")
				?.legacyActions,
		).toEqual(["首页:guide"]);
		expect(
			FROZEN_DOMAIN_GATE_CATALOG.find(
				(gate) => gate.id === "treatment-companion",
			)?.legacyActions,
		).toEqual(["首页:companion"]);
		expect(
			FROZEN_DOMAIN_GATE_CATALOG.find((gate) => gate.id === "patient-qr")
				?.legacyActions,
		).toEqual(["首页:patient-qr"]);
		expect(
			FROZEN_DOMAIN_GATE_CATALOG.find(
				(gate) => gate.id === "outpatient-payment-write",
			)?.legacyActions,
		).toEqual(["门诊费用:outpatient-payment-write"]);
		expect(
			FROZEN_DOMAIN_GATE_CATALOG.find((gate) => gate.id === "patient-agreement")
				?.safeReadOnlyTarget,
		).toBe("pages/patient-agreement/patient-agreement");
	});

	test("健康自测只允许显式声明的安全数值子集进入 partial", () => {
		const gate = FROZEN_DOMAIN_GATE_CATALOG.find(
			(item) => item.id === "health-test",
		);

		// 题库、风险评估和结果页仍然必须停留在 surface-only；
		// 只有已经通过代码边界证明不产生临床结论的两个旧入口可以 partial。
		expect(gate?.safePartialPaths).toEqual([
			"pagesB/health/blood_pressure_calc.vue",
			"pagesB/health/bmi_calc.vue",
		]);
		expect(gate?.safePartialPaths).not.toContain(
			"pagesB/health/self_test_result.vue",
		);
	});

	test("四个非支付入口显式声明当前已经完成的安全子集", () => {
		const expectedSafePartialPaths = {
			"blood-appointment": "pagesB/hospital/bloodAppointment.vue",
			"patient-express": "pagesB/patient/express.vue",
			"patient-signature": "pagesB/patient/patient_signature.vue",
			"patient-subscription": "pagesB/user/subscription_message.vue",
		};

		for (const [gateId, legacyPath] of Object.entries(
			expectedSafePartialPaths,
		)) {
			const gate = FROZEN_DOMAIN_GATE_CATALOG.find(
				(item) => item.id === gateId,
			);

			// 安全子集必须显式绑定到旧入口，避免未来新增 partial 页面时
			// 绕过人工审查，把 provider 或外部会话能力误报为已迁移。
			expect(gate?.safePartialPaths).toEqual([legacyPath]);
			expect(gate?.safeSurfaceTarget).toBeString();
		}
	});
});
