import { describe, expect, test } from "bun:test";
import { buildHealthKnowledgeQualityFindings } from "./health-knowledge-quality-findings.mjs";

function sourceSnapshot(overrides = {}) {
	return {
		schemaVersion: 1,
		source: {
			system: "legacy-hospital",
			exportedAt: "2026-08-25T05:01:01.896Z",
			mappingVersion: "legacy-health-knowledge-v1",
			publicationState: "not-approved",
		},
		items: [{ id: "disease-1", kind: "disease", name: "示例\u0001" }],
		diseaseDetails: [
			{
				id: "disease-1",
				diseaseName: "示例疾病",
				availableDrugs: [
					{ drugName: "示例药品", isClickable: true },
					{ drugName: "示例药品", isClickable: false },
				],
			},
		],
		drugDetails: [],
		diseaseRelations: [],
		partSymptoms: [],
		symptomDiseases: [],
		quality: {
			ignoredLegacyFields: [],
			ignoredLegacySources: [],
			duplicateDiseaseDrugNames: [{ diseaseId: "disease-1" }],
			clickableDrugReferencesWithoutId: [{ diseaseId: "disease-1" }],
			trimmedTextFieldCount: 0,
			defaultedInitialLetterCount: 0,
			legacyControlCharacterCount: 1,
		},
		...overrides,
	};
}

describe("健康知识质量定位报告", () => {
	test("只输出位置和数量，不输出健康知识名称或正文", () => {
		const report = buildHealthKnowledgeQualityFindings(sourceSnapshot());

		expect(report.redaction.valuesIncluded).toBe(false);
		expect(report.findingCounts).toMatchObject({
			duplicateDiseaseDrugNames: 1,
			clickableDrugReferencesWithoutId: 1,
			legacyControlCharacterOccurrences: 1,
		});
		expect(report.findings.duplicateDiseaseDrugNames).toEqual([
			{ detailIndex: 0, referenceIndexes: [0, 1] },
		]);
		expect(report.findings.clickableDrugReferencesWithoutId).toEqual([
			{ detailIndex: 0, referenceIndex: 0 },
		]);
		expect(report.findings.legacyControlCharacters).toEqual([
			{ path: "$.items[0].name", count: 1 },
		]);
		const serialized = JSON.stringify(report);
		expect(serialized).not.toContain("示例疾病");
		expect(serialized).not.toContain("示例药品");
	});

	test("敏感字段或错误质量摘要仍沿用源快照 fail-closed 门禁", () => {
		const source = sourceSnapshot({
			items: [
				{
					id: "disease-1",
					kind: "disease",
					name: "示例",
					patientName: "不应出现",
				},
			],
		});

		expect(() => buildHealthKnowledgeQualityFindings(source)).toThrow(
			"forbidden keys found",
		);
	});
});
