import { expect, test } from "bun:test";
import type { HealthKnowledgeRepository } from "@hospital/domain";
import {
	HEALTH_KNOWLEDGE_DISCLAIMER,
	HealthKnowledgeContentUnavailableError,
	HealthKnowledgeResultValidationError,
} from "@hospital/domain";
import { createLogger } from "@hospital/observability";
import {
	HealthKnowledgeNotFoundError,
	HealthKnowledgeService,
} from "./service";

const publication = {
	contentVersion: "health-2026-08-15",
	reviewedAt: "2026-08-15T00:00:00.000Z",
	sourceLabel: "医院健康科普审核组",
	disclaimer: HEALTH_KNOWLEDGE_DISCLAIMER,
};

function createRepository(
	overrides: Partial<HealthKnowledgeRepository> = {},
): HealthKnowledgeRepository {
	const unavailable = async (): Promise<never> => {
		throw new HealthKnowledgeContentUnavailableError();
	};
	return {
		listCatalog: unavailable,
		listDiseasesByRelation: unavailable,
		listSymptomsByPart: unavailable,
		listDiseasesBySymptoms: unavailable,
		getDiseaseDetail: unavailable,
		getDrugDetail: unavailable,
		...overrides,
	};
}

test("health knowledge service returns a stable publication envelope and logs metadata only", async () => {
	const lines: string[] = [];
	const service = new HealthKnowledgeService({
		repository: createRepository({
			listCatalog: async () => ({
				publication,
				items: [
					{
						id: "part-respiratory",
						name: "呼吸系统",
						patientName: "不应穿过健康知识边界",
					},
				],
			}),
		}),
		logger: createLogger({
			service: "hospital-api-test",
			environment: "test",
			level: "info",
			destination: {
				write(chunk: string) {
					lines.push(chunk);
				},
			},
		}),
	});

	await expect(service.listCatalog("part")).resolves.toEqual({
		publication,
		items: [{ id: "part-respiratory", name: "呼吸系统" }],
		total: 1,
	});
	const records = lines.map(
		(line) => JSON.parse(line) as Record<string, unknown>,
	);
	expect(records.map((record) => record.event)).toEqual([
		"health-knowledge.read.requested",
		"health-knowledge.read.completed",
	]);
	expect(JSON.stringify(records)).not.toContain("呼吸系统");
	expect(records[1]).toMatchObject({
		operation: "catalog",
		contentVersion: "health-2026-08-15",
		itemCount: 1,
	});
});

test("health knowledge service maps disease details and rejects missing documents", async () => {
	const service = new HealthKnowledgeService({
		repository: createRepository({
			getDiseaseDetail: async () => ({
				publication,
				item: {
					id: "disease-cold",
					diseaseName: "普通感冒",
					availableDrugs: [
						{
							drugId: "drug-cold",
							drugName: "示例药物",
							isClickable: true,
						},
					],
				},
			}),
		}),
	});

	await expect(service.getDiseaseDetail("disease-cold")).resolves.toEqual({
		publication,
		item: {
			id: "disease-cold",
			diseaseName: "普通感冒",
			availableDrugs: [
				{
					drugId: "drug-cold",
					drugName: "示例药物",
					isClickable: true,
				},
			],
		},
	});

	const missing = new HealthKnowledgeService({
		repository: createRepository({ getDiseaseDetail: async () => undefined }),
	});
	await expect(
		missing.getDiseaseDetail("missing-disease"),
	).rejects.toBeInstanceOf(HealthKnowledgeNotFoundError);
});

test("health knowledge service fails closed and logs only a fixed violation", async () => {
	const lines: string[] = [];
	const service = new HealthKnowledgeService({
		repository: createRepository({
			listCatalog: async () => ({
				publication,
				items: [{ id: "part-respiratory", name: " 呼吸系统" }],
			}),
		}),
		logger: createLogger({
			service: "hospital-api-test",
			environment: "test",
			level: "info",
			destination: {
				write(chunk: string) {
					lines.push(chunk);
				},
			},
		}),
	});

	await expect(service.listCatalog("part")).rejects.toBeInstanceOf(
		HealthKnowledgeResultValidationError,
	);
	const records = lines.map(
		(line) => JSON.parse(line) as Record<string, unknown>,
	);
	expect(records.map((record) => record.event)).toEqual([
		"health-knowledge.read.requested",
		"health-knowledge.read.failed",
	]);
	expect(JSON.stringify(records)).not.toContain("呼吸系统");
	expect(records[1]).toMatchObject({
		operation: "catalog",
		resultViolation: "catalog-item-invalid",
	});
});
