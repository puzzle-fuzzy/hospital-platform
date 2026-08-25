import { describe, expect, test } from "bun:test";
import { buildHealthKnowledgeReviewQueue } from "./health-knowledge-review-queue.mjs";
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
		items: [{ id: "disease-1", kind: "disease", name: "示例" }],
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

describe("健康知识迁移审核队列", () => {
	test("质量告警和未审核状态会形成明确的阻断门", () => {
		const source = sourceSnapshot({
			items: [{ id: "disease-1", kind: "disease", name: "示\u0001例\u0002" }],
		});
		source.quality.legacyControlCharacterCount = 2;
		const report = buildHealthKnowledgeReviewQueue(
			auditLegacyHealthKnowledgeSource(source),
		);

		expect(report.publishable).toBe(false);
		expect(report.unresolvedGateCount).toBe(6);
		expect(report.gates).toContainEqual(
			expect.objectContaining({
				id: "source-quality",
				status: "blocked",
				warningCount: 2,
			}),
		);
		expect(report.gates).toContainEqual(
			expect.objectContaining({
				id: "clinical-review",
				status: "blocked",
				sourcePublicationState: "not-approved",
			}),
		);
	});

	test("收到 bundle 文件也不能跳过校验、导入和真机门", () => {
		const report = buildHealthKnowledgeReviewQueue(
			auditLegacyHealthKnowledgeSource(sourceSnapshot()),
			{ reviewedBundlePresent: true },
		);

		expect(report.publishable).toBe(false);
		expect(report.gates).toContainEqual(
			expect.objectContaining({
				id: "bundle-metadata",
				status: "pending-validation",
			}),
		);
		expect(report.unresolvedGateCount).toBe(5);
		expect(JSON.stringify(report)).not.toContain("示例");
	});
});
