import { expect, test } from "bun:test";
import type { HealthKnowledgeRepository } from "@hospital/domain";
import {
	HEALTH_KNOWLEDGE_DISCLAIMER,
	HealthKnowledgeContentUnavailableError,
	HealthKnowledgeResultValidationError,
	HealthKnowledgeValidationError,
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

test("health knowledge service validates direct inputs before repository access", async () => {
	let repositoryCalls = 0;
	const service = new HealthKnowledgeService({
		repository: createRepository({
			listCatalog: async () => {
				repositoryCalls += 1;
				throw new Error("catalog repository must not be called");
			},
			listDiseasesByRelation: async () => {
				repositoryCalls += 1;
				throw new Error("relation repository must not be called");
			},
			listSymptomsByPart: async () => {
				repositoryCalls += 1;
				throw new Error("symptom repository must not be called");
			},
			listDiseasesBySymptoms: async () => {
				repositoryCalls += 1;
				throw new Error("symptom disease repository must not be called");
			},
			getDiseaseDetail: async () => {
				repositoryCalls += 1;
				throw new Error("disease repository must not be called");
			},
			getDrugDetail: async () => {
				repositoryCalls += 1;
				throw new Error("drug repository must not be called");
			},
		}),
	});

	// 这些调用绕过 HTTP schema，必须仍然在 repository 前失败；否则错误的
	// 分类、关联对象或条目 id 会进入数据库查询，错误结果可能被当成合法空结果。
	await expect(service.listCatalog("unknown" as never)).rejects.toBeInstanceOf(
		HealthKnowledgeValidationError,
	);
	await expect(
		service.listDiseasesByRelation({ kind: "unknown", id: "part-1" } as never),
	).rejects.toBeInstanceOf(HealthKnowledgeValidationError);
	await expect(
		service.listSymptomsByPart("part-1\u0000" as never),
	).rejects.toBeInstanceOf(HealthKnowledgeValidationError);
	await expect(
		service.listDiseasesBySymptoms(null as never),
	).rejects.toBeInstanceOf(HealthKnowledgeValidationError);
	await expect(
		service.getDiseaseDetail("\n disease-1" as never),
	).rejects.toBeInstanceOf(HealthKnowledgeValidationError);
	await expect(
		service.getDrugDetail("drug-1\u007f" as never),
	).rejects.toBeInstanceOf(HealthKnowledgeValidationError);

	expect(repositoryCalls).toBe(0);
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

test("health knowledge service rejects a detail returned for another requested id", async () => {
	const service = new HealthKnowledgeService({
		repository: createRepository({
			getDiseaseDetail: async () => ({
				publication,
				item: {
					id: "disease-other",
					diseaseName: "另一种疾病",
					availableDrugs: [],
				},
			}),
		}),
	});

	await expect(service.getDiseaseDetail("disease-cold")).rejects.toMatchObject({
		name: "HealthKnowledgeResultValidationError",
		violation: "disease-detail-invalid",
	});
});
