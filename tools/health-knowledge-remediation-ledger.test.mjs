import { describe, expect, test } from "bun:test";
import {
	buildHealthKnowledgeRemediationLedger,
	REMEDIATION_GATE_IDS,
	REMEDIATION_LEDGER_SCHEMA_VERSION,
} from "./health-knowledge-remediation-ledger.mjs";

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

describe("健康知识整改台账", () => {
	test("把源质量、临床审核和发布证据拆成独立 gate", () => {
		const ledger = buildHealthKnowledgeRemediationLedger(sourceSnapshot());

		expect(ledger.schemaVersion).toBe(REMEDIATION_LEDGER_SCHEMA_VERSION);
		expect(ledger.publishable).toBe(false);
		expect(ledger.status).toBe("blocked");
		expect(ledger.findingCounts).toMatchObject({
			duplicateDiseaseDrugNames: 1,
			clickableDrugReferencesWithoutId: 1,
			legacyControlCharacterOccurrences: 1,
		});
		expect(ledger.gates.map((item) => item.id)).toEqual([
			REMEDIATION_GATE_IDS.sourceQuality,
			REMEDIATION_GATE_IDS.clinicalReview,
			REMEDIATION_GATE_IDS.bundleMetadata,
			REMEDIATION_GATE_IDS.stagingImport,
			REMEDIATION_GATE_IDS.publicationDrill,
			REMEDIATION_GATE_IDS.deviceAcceptance,
		]);
		expect(ledger.gates[0]?.status).toBe("blocked");
		expect(ledger.gates[1]?.status).toBe("blocked");
		expect(ledger.gates[2]?.status).toBe("pending-input");
	});

	test("即使质量告警清零，也不会自动把未审核源快照标记为可发布", () => {
		const source = sourceSnapshot({
			items: [{ id: "disease-1", kind: "disease", name: "示例" }],
			diseaseDetails: [
				{
					id: "disease-1",
					diseaseName: "示例疾病",
					availableDrugs: [],
				},
			],
			quality: {
				ignoredLegacyFields: [],
				ignoredLegacySources: [],
				duplicateDiseaseDrugNames: [],
				clickableDrugReferencesWithoutId: [],
				trimmedTextFieldCount: 0,
				defaultedInitialLetterCount: 0,
				legacyControlCharacterCount: 0,
			},
		});

		const ledger = buildHealthKnowledgeRemediationLedger(source);
		expect(ledger.gates[0]?.status).toBe("ready");
		expect(ledger.gates[1]?.status).toBe("blocked");
		expect(ledger.publishable).toBe(false);
		expect(ledger.nextAction).toContain("独立审核 bundle");
	});

	test("整改台账不泄漏健康知识名称或正文", () => {
		const serialized = JSON.stringify(
			buildHealthKnowledgeRemediationLedger(sourceSnapshot()),
		);
		expect(serialized).not.toContain("示例疾病");
		expect(serialized).not.toContain("示例药品");
		expect(serialized).not.toContain("\u0001");
		expect(serialized).toContain('"valuesIncluded":false');
	});
});
