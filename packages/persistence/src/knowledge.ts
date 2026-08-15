import type { HealthKnowledgeRepository } from "@hospital/domain";
import { PersistenceNotConfiguredError } from "./errors";

/**
 * 健康知识的真实 MySQL repository 尚未接入前，所有读取都显式失败。
 * 不提供默认 fixture，避免把医疗内容的内存样本误当成生产数据源。
 */
export function createNotConfiguredHealthKnowledgeRepository(): HealthKnowledgeRepository {
	const unavailable = async (): Promise<never> => {
		throw new PersistenceNotConfiguredError("health-knowledge");
	};

	return {
		listCatalog: unavailable,
		listDiseasesByRelation: unavailable,
		listSymptomsByPart: unavailable,
		listDiseasesBySymptoms: unavailable,
		getDiseaseDetail: unavailable,
		getDrugDetail: unavailable,
	};
}
