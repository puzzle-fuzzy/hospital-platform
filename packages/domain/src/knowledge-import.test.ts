import { expect, test } from "bun:test";
import {
	HEALTH_KNOWLEDGE_DISCLAIMER,
	type HealthKnowledgeImportBundle,
	HealthKnowledgeImportValidationError,
	validateHealthKnowledgeImportBundle,
} from "./index";

function validBundle(): HealthKnowledgeImportBundle {
	return {
		publication: {
			contentVersion: "health-2026-08-15",
			status: "published",
			reviewedAt: "2026-08-15T00:00:00.000Z",
			sourceLabel: "医院健康科普审核组",
			disclaimer: HEALTH_KNOWLEDGE_DISCLAIMER,
			reviewerRef: "reviewer-001",
		},
		items: [
			{ id: "crowd-adult", kind: "crowd", name: "成年人" },
			{ id: "department-respiratory", kind: "department", name: "呼吸内科" },
			{ id: "part-respiratory", kind: "part", name: "呼吸系统" },
			{
				id: "symptom-cough",
				kind: "symptom",
				name: "咳嗽",
				initialLetter: "K",
			},
			{
				id: "disease-cold",
				kind: "disease",
				name: "普通感冒",
				initialLetter: "P",
			},
			{ id: "drug-cold", kind: "drug", name: "示例药物" },
		],
		diseaseDetails: [
			{
				id: "disease-cold",
				diseaseName: "普通感冒",
				availableDrugs: [
					{ drugId: "drug-cold", drugName: "示例药物", isClickable: true },
				],
			},
		],
		drugDetails: [{ id: "drug-cold", drugName: "示例药物" }],
		diseaseRelations: [
			{
				kind: "crowd",
				relationId: "crowd-adult",
				diseaseId: "disease-cold",
			},
			{
				kind: "department",
				relationId: "department-respiratory",
				diseaseId: "disease-cold",
			},
			{
				kind: "part",
				relationId: "part-respiratory",
				diseaseId: "disease-cold",
			},
		],
		partSymptoms: [{ partId: "part-respiratory", symptomId: "symptom-cough" }],
		symptomDiseases: [
			{ symptomId: "symptom-cough", diseaseId: "disease-cold" },
		],
	};
}

test("health knowledge import validator returns an auditable bundle summary", () => {
	expect(validateHealthKnowledgeImportBundle(validBundle())).toEqual({
		contentVersion: "health-2026-08-15",
		status: "published",
		itemCount: 6,
		diseaseCount: 1,
		drugCount: 1,
		relationCount: 5,
	});
});

test("stable item ids remain valid when a new content version is prepared", () => {
	const nextVersion = validBundle();
	nextVersion.publication = {
		...nextVersion.publication,
		contentVersion: "health-2026-08-16",
		reviewedAt: "2026-08-16T00:00:00.000Z",
	};

	expect(validateHealthKnowledgeImportBundle(nextVersion).contentVersion).toBe(
		"health-2026-08-16",
	);
});

test("health knowledge import validator rejects cross-kind references before SQL", () => {
	const bundle = validBundle();
	bundle.partSymptoms = [{ partId: "crowd-adult", symptomId: "symptom-cough" }];

	expect(() => validateHealthKnowledgeImportBundle(bundle)).toThrow(
		HealthKnowledgeImportValidationError,
	);
});

test("published health knowledge requires a reviewer reference and clickable drugs need ids", () => {
	const missingReviewer = validBundle();
	delete missingReviewer.publication.reviewerRef;
	expect(() => validateHealthKnowledgeImportBundle(missingReviewer)).toThrow(
		"publication.reviewerRef",
	);

	const missingDrugId = validBundle();
	missingDrugId.diseaseDetails = missingDrugId.diseaseDetails.map((detail) => ({
		...detail,
		availableDrugs: [{ drugName: "示例药物", isClickable: true }],
	}));
	expect(() => validateHealthKnowledgeImportBundle(missingDrugId)).toThrow(
		"diseaseDetails[0].availableDrugs[0].isClickable",
	);
});

test("health knowledge publication timestamps must carry an explicit timezone", () => {
	const reviewedAtWithoutTimezone = validBundle();
	reviewedAtWithoutTimezone.publication.reviewedAt = "2026-08-15T00:00:00.000";
	expect(() =>
		validateHealthKnowledgeImportBundle(reviewedAtWithoutTimezone),
	).toThrow("publication.reviewedAt");

	const effectiveWindowWithoutTimezone = validBundle();
	effectiveWindowWithoutTimezone.publication.effectiveFrom =
		"2026-08-15T00:00:00";
	expect(() =>
		validateHealthKnowledgeImportBundle(effectiveWindowWithoutTimezone),
	).toThrow("publication.effectiveFrom");

	const explicitOffset = validBundle();
	explicitOffset.publication.reviewedAt = "2026-08-15T08:00:00+08:00";
	explicitOffset.publication.effectiveFrom = "2026-08-15T00:00:00Z";
	explicitOffset.publication.effectiveTo = "2026-08-16T00:00:00Z";
	expect(
		validateHealthKnowledgeImportBundle(explicitOffset).contentVersion,
	).toBe("health-2026-08-15");
});
