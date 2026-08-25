import { describe, expect, test } from "bun:test";
import { auditLegacyHealthKnowledgeSource } from "./health-knowledge-source-audit.mjs";

function sourceSnapshot(overrides = {}) {
	return {
		schemaVersion: 1,
		source: {
			system: "legacy-hospital",
			exportedAt: "2026-08-25T05:01:01.896Z",
			mappingVersion: "legacy-health-knowledge-v1",
			publicationState: "not-approved",
		},
		items: [
			{ id: "legacy-hk-disease-1", kind: "disease", name: "示例" },
			{ id: "legacy-hk-drug-1", kind: "drug", name: "示例药品" },
		],
		diseaseDetails: [],
		drugDetails: [],
		diseaseRelations: [],
		partSymptoms: [],
		symptomDiseases: [],
		quality: {
			ignoredLegacyFields: [],
			ignoredLegacySources: [],
			duplicateDiseaseDrugNames: [],
			clickableDrugReferencesWithoutId: [],
			trimmedTextFieldCount: 0,
			defaultedInitialLetterCount: 0,
			legacyControlCharacterCount: 0,
		},
		...overrides,
	};
}

describe("旧健康知识源快照审计", () => {
	test("只输出聚合规模，并把源数据保持为不可发布状态", () => {
		const report = auditLegacyHealthKnowledgeSource(sourceSnapshot());

		expect(report).toMatchObject({
			sourceValid: true,
			publishable: false,
			strictPassed: true,
			counts: {
				items: 2,
				itemsByKind: { disease: 1, drug: 1 },
			},
		});
		expect(report.source.publicationState).toBe("not-approved");
	});

	test("默认模式保留质量告警，strict 模式拒绝带告警的源快照", () => {
		const base = sourceSnapshot();
		const snapshot = sourceSnapshot({
			items: [
				{ id: "legacy-hk-disease-1", kind: "disease", name: "示\u0001例" },
				{ id: "legacy-hk-drug-1", kind: "drug", name: "示例药品" },
			],
			quality: {
				...base.quality,
				legacyControlCharacterCount: 1,
			},
		});

		expect(auditLegacyHealthKnowledgeSource(snapshot).strictPassed).toBe(true);
		expect(
			auditLegacyHealthKnowledgeSource(snapshot, { strict: true }).strictPassed,
		).toBe(false);
	});

	test("质量摘要与源投影不一致时立即拒绝", () => {
		const base = sourceSnapshot({
			diseaseDetails: [
				{
					id: "legacy-hk-disease-1",
					diseaseName: "示例",
					availableDrugs: [{ drugName: "示例药品", isClickable: false }],
				},
			],
		});
		base.quality.legacyControlCharacterCount = 1;

		expect(() => auditLegacyHealthKnowledgeSource(base)).toThrow(
			"quality summary does not match source projection",
		);
	});

	test("发现患者或 Provider 标识字段时立即失败", () => {
		const snapshot = sourceSnapshot({
			items: [
				{
					id: "legacy-hk-disease-1",
					kind: "disease",
					name: "示例",
					patientName: "不应出现",
				},
			],
		});

		expect(() => auditLegacyHealthKnowledgeSource(snapshot)).toThrow(
			"forbidden keys found",
		);
	});

	test("已发布或错误映射版本不能被当作旧源快照", () => {
		const base = sourceSnapshot();
		const snapshot = sourceSnapshot({
			source: {
				...base.source,
				publicationState: "published",
			},
		});

		expect(() => auditLegacyHealthKnowledgeSource(snapshot)).toThrow(
			"source snapshot must remain not-approved",
		);
	});
});
