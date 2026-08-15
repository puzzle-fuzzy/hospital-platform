import { expect, test } from "bun:test";
import type { HealthKnowledgeRepository } from "@hospital/domain";
import { HEALTH_KNOWLEDGE_DISCLAIMER } from "@hospital/domain";
import { createInMemorySessionTokenService } from "../auth/service";
import { healthKnowledgeModule } from "./index";
import { HealthKnowledgeService } from "./service";

const publication = {
	contentVersion: "health-2026-08-15",
	reviewedAt: "2026-08-15T00:00:00.000Z",
	sourceLabel: "医院健康科普审核组",
	disclaimer: HEALTH_KNOWLEDGE_DISCLAIMER,
};

function createRepository(): HealthKnowledgeRepository {
	return {
		listCatalog: async () => ({
			publication,
			items: [{ id: "part-respiratory", name: "呼吸系统" }],
		}),
		listDiseasesByRelation: async (relation) => ({
			publication,
			items: [
				{
					id: `disease-${relation.kind}-${relation.id}`,
					name: "普通感冒",
					initialLetter: "P",
				},
			],
		}),
		listSymptomsByPart: async () => ({
			publication,
			items: [{ id: "symptom-cough", name: "咳嗽", initialLetter: "K" }],
		}),
		listDiseasesBySymptoms: async (symptomIds) => ({
			publication,
			items: [
				{
					id: `disease-by-${symptomIds.join("-")}`,
					name: "普通感冒",
					initialLetter: "P",
				},
			],
		}),
		getDiseaseDetail: async () => ({
			publication,
			item: {
				id: "disease-cold",
				diseaseName: "普通感冒",
				availableDrugs: [],
			},
		}),
		getDrugDetail: async () => ({
			publication,
			item: { id: "drug-cold", drugName: "示例药物" },
		}),
	};
}

test("health knowledge module preserves legacy read paths with new safe payloads", async () => {
	const sessions = createInMemorySessionTokenService();
	const issued = await sessions.issue("fixture-user-0001");
	const app = healthKnowledgeModule(
		new HealthKnowledgeService({ repository: createRepository() }),
		sessions,
	);
	const headers = { authorization: `Bearer ${issued.accessToken}` };

	const catalog = await app.handle(
		new Request("http://localhost/knowledge/health/part/list", { headers }),
	);
	const diseaseList = await app.handle(
		new Request(
			"http://localhost/knowledge/health/disease/list/symptoms?symptomIds=symptom-cough&symptomIds=symptom-fever",
			{ headers },
		),
	);
	const detail = await app.handle(
		new Request(
			"http://localhost/knowledge/health/disease/detail/disease-cold",
			{ headers },
		),
	);

	expect(catalog.status).toBe(200);
	expect(await catalog.json()).toEqual({
		success: true,
		data: {
			publication,
			items: [{ id: "part-respiratory", name: "呼吸系统" }],
			total: 1,
		},
	});
	expect(diseaseList.status).toBe(200);
	expect(await diseaseList.json()).toMatchObject({
		success: true,
		data: {
			total: 1,
			items: [{ id: "disease-by-symptom-cough-symptom-fever" }],
		},
	});
	expect(detail.status).toBe(200);
	expect(await detail.json()).toMatchObject({
		success: true,
		data: { item: { id: "disease-cold", availableDrugs: [] } },
	});
});
