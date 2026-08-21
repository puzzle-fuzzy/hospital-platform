import { expect, test } from "bun:test";
import {
	groupHealthKnowledgeByInitialLetter,
	HEALTH_KNOWLEDGE_DISCLAIMER,
	HealthKnowledgeResultValidationError,
	HealthKnowledgeValidationError,
	normalizeHealthKnowledgeCatalogSnapshot,
	normalizeHealthKnowledgeDiseaseDocument,
	normalizeHealthKnowledgeDrugDocument,
	validateHealthKnowledgeCatalogKind,
	validateHealthKnowledgePublication,
	validateHealthKnowledgeSymptomIds,
} from "./knowledge";

const publication = {
	contentVersion: "health-2026-08-15",
	reviewedAt: "2026-08-15T00:00:00.000Z",
	sourceLabel: "医院健康教育内容",
	disclaimer: HEALTH_KNOWLEDGE_DISCLAIMER,
};

test("health knowledge publication requires traceable review metadata", () => {
	expect(() => validateHealthKnowledgePublication(publication)).not.toThrow();
	expect(() =>
		validateHealthKnowledgePublication({
			...publication,
			reviewedAt: "not-a-date",
		}),
	).toThrow(HealthKnowledgeValidationError);
	expect(() =>
		validateHealthKnowledgePublication({
			...publication,
			disclaimer: "可由内容导入覆盖的文案",
		}),
	).toThrow(HealthKnowledgeValidationError);
	expect(() =>
		validateHealthKnowledgePublication({
			...publication,
			sourceLabel: "医院健康教育内容\u0000",
		}),
	).toThrow(HealthKnowledgeValidationError);
});

test("health knowledge groups stable letters and keeps empty values isolated", () => {
	const groups = groupHealthKnowledgeByInitialLetter([
		{ id: "d-2", initialLetter: "b", name: "病症二" },
		{ id: "d-1", initialLetter: "A", name: "病症一" },
		{ id: "d-3", initialLetter: "", name: "未分类" },
	]);

	expect(Object.keys(groups)).toEqual(["#", "A", "B"]);
	expect(groups.A?.[0]?.id).toBe("d-1");
	expect(groups["#"]?.[0]?.name).toBe("未分类");
});

test("health knowledge symptom queries reject empty, duplicate and oversized input", () => {
	expect(() => validateHealthKnowledgeSymptomIds(["s-1"])).not.toThrow();
	expect(() => validateHealthKnowledgeSymptomIds([])).toThrow(
		HealthKnowledgeValidationError,
	);
	expect(() => validateHealthKnowledgeSymptomIds(["s-1", "s-1"])).toThrow(
		HealthKnowledgeValidationError,
	);
	expect(() =>
		validateHealthKnowledgeSymptomIds(
			Array.from({ length: 11 }, (_, index) => `s-${index}`),
		),
	).toThrow(HealthKnowledgeValidationError);
});

test("health knowledge catalog kinds reject unknown runtime values", () => {
	expect(() => validateHealthKnowledgeCatalogKind("part")).not.toThrow();
	expect(() => validateHealthKnowledgeCatalogKind("provider" as never)).toThrow(
		HealthKnowledgeValidationError,
	);
});

test("health knowledge read models are re-projected to the public allowlist", () => {
	const result = normalizeHealthKnowledgeCatalogSnapshot({
		publication: { ...publication, internalReviewerNote: "仅后台可见" },
		items: [
			{
				id: "part-respiratory",
				name: "呼吸系统",
				patientName: "不应出现在健康知识中",
			},
		],
	});

	expect(result).toEqual({
		publication,
		items: [{ id: "part-respiratory", name: "呼吸系统" }],
	});
});

test("health knowledge read models reject duplicate or malformed medical items", () => {
	expect(() =>
		normalizeHealthKnowledgeCatalogSnapshot({
			publication,
			items: [
				{ id: "part-1", name: "呼吸系统" },
				{ id: "part-1", name: "循环系统" },
			],
		}),
	).toThrow(HealthKnowledgeResultValidationError);

	expect(() =>
		normalizeHealthKnowledgeDiseaseDocument({
			publication,
			item: {
				id: "disease-cold",
				diseaseName: "普通感冒",
				availableDrugs: [{ drugName: "示例药物", isClickable: true }],
			},
		}),
	).toThrow(HealthKnowledgeResultValidationError);
});

test("health knowledge drug details keep the public field boundary", () => {
	const result = normalizeHealthKnowledgeDrugDocument({
		publication,
		item: {
			id: "drug-cold",
			drugName: "示例药物",
			indications: "用于知识内容展示",
			providerRawPayload: { secret: true },
		},
	});

	expect(result).toEqual({
		publication,
		item: {
			id: "drug-cold",
			drugName: "示例药物",
			indications: "用于知识内容展示",
		},
	});
});

test("health knowledge medical正文保留换行，但拒绝其它控制字符", () => {
	const disease = normalizeHealthKnowledgeDiseaseDocument({
		publication,
		item: {
			id: "disease-cold",
			diseaseName: "普通感冒",
			availableDrugs: [],
			symptoms: "第一行\n第二行",
		},
	});

	expect(disease?.item.symptoms).toBe("第一行\n第二行");
	expect(() =>
		normalizeHealthKnowledgeDiseaseDocument({
			publication,
			item: {
				id: "disease-cold",
				diseaseName: "普通感冒",
				availableDrugs: [],
				symptoms: "第一行\u0000第二行",
			},
		}),
	).toThrow(HealthKnowledgeResultValidationError);
});

test("health knowledge detail results must match the requested opaque id", () => {
	const diseaseDocument = {
		publication,
		item: {
			id: "disease-other",
			diseaseName: "另一种疾病",
			availableDrugs: [],
		},
	};
	const drugDocument = {
		publication,
		item: { id: "drug-other", drugName: "另一种药物" },
	};

	expect(() =>
		normalizeHealthKnowledgeDiseaseDocument(diseaseDocument, "disease-cold"),
	).toThrow(HealthKnowledgeResultValidationError);
	expect(() =>
		normalizeHealthKnowledgeDrugDocument(drugDocument, "drug-cold"),
	).toThrow(HealthKnowledgeResultValidationError);
});
