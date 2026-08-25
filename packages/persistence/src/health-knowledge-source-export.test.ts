import { expect, test } from "bun:test";
import {
	type LegacyHealthKnowledgeRows,
	mapLegacyHealthKnowledgeSource,
} from "./health-knowledge-source-export";

function sourceRows(): LegacyHealthKnowledgeRows {
	return {
		crowds: [{ id: 1, name: " 成人 " }],
		departments: [{ id: 2, name: "呼吸内科" }],
		parts: [{ id: 3, name: "呼吸系统" }],
		symptoms: [{ id: 4, name: "咳嗽", initialLetter: "" }],
		diseases: [
			{
				id: 5,
				name: "普通感冒",
				initialLetter: "P",
				diseaseAlias: null,
				affectedPart: null,
				treatmentDepartment: null,
				susceptibleCrowd: null,
				cause: "病毒",
				symptoms: "咳嗽\n鼻塞",
				examination: null,
				prevention: null,
				treatment: null,
			},
		],
		drugs: [
			{
				id: 6,
				name: "对乙酰氨基酚",
				manufacturer: null,
				chineseName: null,
				specifications: null,
				treatableDiseases: null,
				indications: null,
				usageDosage: null,
				adverseReactions: null,
				contraindications: null,
				interactions: null,
				precautions: null,
			},
		],
		diseaseDrugs: [
			{ diseaseId: 5, drugId: 6, drugName: "对乙酰氨基酚", isClickable: 1 },
			{ diseaseId: 5, drugId: null, drugName: "对乙酰氨基酚", isClickable: 0 },
		],
		crowdDiseases: [{ relationId: 1, diseaseId: 5 }],
		departmentDiseases: [{ relationId: 2, diseaseId: 5 }],
		partDiseases: [{ relationId: 3, diseaseId: 5 }],
		partSymptoms: [{ partId: 3, symptomId: 4 }],
		symptomDiseases: [{ symptomId: 4, diseaseId: 5 }],
	};
}

test("旧健康知识映射使用稳定 opaque id，并保留需要人工处理的关系告警", () => {
	const snapshot = mapLegacyHealthKnowledgeSource(
		sourceRows(),
		"2026-08-25T00:00:00.000Z",
	);

	expect(snapshot.source.publicationState).toBe("not-approved");
	expect(snapshot.items).toContainEqual({
		id: "legacy-hk-crowd-1",
		kind: "crowd",
		name: "成人",
	});
	expect(snapshot.items).toContainEqual({
		id: "legacy-hk-symptom-4",
		kind: "symptom",
		name: "咳嗽",
		initialLetter: "#",
	});
	expect(snapshot.quality.defaultedInitialLetterCount).toBe(1);
	expect(snapshot.quality.trimmedTextFieldCount).toBe(1);
	expect(snapshot.diseaseDetails[0]?.availableDrugs).toHaveLength(2);
	expect(snapshot.quality.duplicateDiseaseDrugNames).toEqual([
		{
			diseaseId: 5,
			drugName: "对乙酰氨基酚",
			sourceDrugIds: [6, null],
		},
	]);
	expect(snapshot.quality.ignoredLegacyFields).toContain(
		"knowledge_disease.available_drugs",
	);
	expect(snapshot.quality.ignoredLegacySources).toContain("knowledge_tips");
});

test("旧关系的 is_clickable 只能按明确的 0/1 映射", () => {
	const rows = sourceRows();
	rows.diseaseDrugs = [
		{ diseaseId: 5, drugId: 6, drugName: "对乙酰氨基酚", isClickable: 2 },
	];

	expect(() =>
		mapLegacyHealthKnowledgeSource(rows, "2026-08-25T00:00:00.000Z"),
	).toThrow("diseaseDrugs.5.isClickable");
});

test("可点击但缺少药品主键的旧关系不会被伪装成可跳转引用", () => {
	const rows = sourceRows();
	rows.diseaseDrugs = [
		{ diseaseId: 5, drugId: null, drugName: "未关联药品", isClickable: 1 },
	];

	const snapshot = mapLegacyHealthKnowledgeSource(
		rows,
		"2026-08-25T00:00:00.000Z",
	);

	expect(snapshot.quality.clickableDrugReferencesWithoutId).toEqual([
		{ diseaseId: 5, drugName: "未关联药品" },
	]);
	expect(snapshot.diseaseDetails[0]?.availableDrugs[0]).toEqual({
		drugName: "未关联药品",
		isClickable: true,
	});
});

test("源快照保留旧正文控制字符但留下正式导入前的质量门禁", () => {
	const rows = sourceRows();
	const disease = rows.diseases[0];
	if (!disease) throw new Error("fixture disease is missing");
	rows.diseases = [{ ...disease, prevention: "需要人工复核\u007f" }];

	const snapshot = mapLegacyHealthKnowledgeSource(
		rows,
		"2026-08-25T00:00:00.000Z",
	);

	expect(snapshot.quality.legacyControlCharacterCount).toBe(1);
	expect(snapshot.diseaseDetails[0]?.prevention).toBe("需要人工复核\u007f");
});
