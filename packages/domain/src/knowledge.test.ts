import { expect, test } from "bun:test";
import {
	groupHealthKnowledgeByInitialLetter,
	HEALTH_KNOWLEDGE_DISCLAIMER,
	HealthKnowledgeValidationError,
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
