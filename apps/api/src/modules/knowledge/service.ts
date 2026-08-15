import type {
	HealthKnowledgeCatalogResponsePayload,
	HealthKnowledgeDiseaseDetailResponsePayload,
	HealthKnowledgeDiseaseListResponsePayload,
	HealthKnowledgeDrugDetailResponsePayload,
	HealthKnowledgeSymptomListResponsePayload,
} from "@hospital/contracts";
import type {
	HealthKnowledgeCatalogKind,
	HealthKnowledgeDiseaseRelation,
	HealthKnowledgeRepository,
} from "@hospital/domain";
import { type AppLogger, createNoopLogger } from "@hospital/observability";

/** 健康知识详情不存在时返回 404，不把空对象误报为可展示内容。 */
export class HealthKnowledgeNotFoundError extends Error {
	readonly resource: "disease" | "drug";

	constructor(resource: "disease" | "drug") {
		super(`Health knowledge ${resource} is not available`);
		this.name = "HealthKnowledgeNotFoundError";
		this.resource = resource;
	}
}

export type HealthKnowledgeServiceDependencies = {
	repository: HealthKnowledgeRepository;
	logger?: AppLogger;
};

/**
 * 健康知识应用服务只编排审核内容的只读查询。
 *
 * 这里不接收患者、provider 或 AI 参数；repository 负责选择同一发布版本，
 * service 负责统一响应形状、日志事件和空内容边界。
 */
export class HealthKnowledgeService {
	private readonly logger: AppLogger;

	constructor(
		private readonly dependencies: HealthKnowledgeServiceDependencies,
	) {
		this.logger = dependencies.logger ?? createNoopLogger();
	}

	async listCatalog(
		kind: HealthKnowledgeCatalogKind,
	): Promise<HealthKnowledgeCatalogResponsePayload["data"]> {
		const snapshot = await this.read("catalog", () =>
			this.dependencies.repository.listCatalog(kind),
		);
		return {
			publication: snapshot.publication,
			items: [...snapshot.items],
			total: snapshot.items.length,
		};
	}

	async listDiseasesByRelation(
		relation: HealthKnowledgeDiseaseRelation,
	): Promise<HealthKnowledgeDiseaseListResponsePayload["data"]> {
		const snapshot = await this.read("disease-relation", () =>
			this.dependencies.repository.listDiseasesByRelation(relation),
		);
		return this.diseaseList(snapshot);
	}

	async listSymptomsByPart(
		partId: string,
	): Promise<HealthKnowledgeSymptomListResponsePayload["data"]> {
		const snapshot = await this.read("symptoms-by-part", () =>
			this.dependencies.repository.listSymptomsByPart(partId),
		);
		return {
			publication: snapshot.publication,
			items: [...snapshot.items],
			total: snapshot.items.length,
		};
	}

	async listDiseasesBySymptoms(
		symptomIds: readonly string[],
	): Promise<HealthKnowledgeDiseaseListResponsePayload["data"]> {
		const snapshot = await this.read("disease-symptoms", () =>
			this.dependencies.repository.listDiseasesBySymptoms(symptomIds),
		);
		return this.diseaseList(snapshot);
	}

	async getDiseaseDetail(
		diseaseId: string,
	): Promise<HealthKnowledgeDiseaseDetailResponsePayload["data"]> {
		const document = await this.read("disease-detail", () =>
			this.dependencies.repository.getDiseaseDetail(diseaseId),
		);
		if (!document) {
			this.logNotFound("disease-detail", "disease");
			throw new HealthKnowledgeNotFoundError("disease");
		}
		return {
			publication: document.publication,
			item: {
				...document.item,
				availableDrugs: [...document.item.availableDrugs],
			},
		};
	}

	async getDrugDetail(
		drugId: string,
	): Promise<HealthKnowledgeDrugDetailResponsePayload["data"]> {
		const document = await this.read("drug-detail", () =>
			this.dependencies.repository.getDrugDetail(drugId),
		);
		if (!document) {
			this.logNotFound("drug-detail", "drug");
			throw new HealthKnowledgeNotFoundError("drug");
		}
		return document;
	}

	private diseaseList(
		snapshot: Awaited<
			ReturnType<HealthKnowledgeRepository["listDiseasesByRelation"]>
		>,
	): HealthKnowledgeDiseaseListResponsePayload["data"] {
		return {
			publication: snapshot.publication,
			items: [...snapshot.items],
			total: snapshot.items.length,
		};
	}

	private async read<T>(operation: string, read: () => Promise<T>): Promise<T> {
		this.logger.info(
			{
				event: "health-knowledge.read.requested",
				operation,
			},
			"Health knowledge read requested",
		);
		try {
			const result = await read();
			const publication = this.publicationOf(result);
			this.logger.info(
				{
					event: "health-knowledge.read.completed",
					operation,
					contentVersion: publication?.contentVersion,
					itemCount: this.itemCountOf(result),
				},
				"Health knowledge read completed",
			);
			return result;
		} catch (error) {
			this.logger.warn(
				{
					event: "health-knowledge.read.failed",
					operation,
					errorName: error instanceof Error ? error.name : "UnknownError",
				},
				"Health knowledge read failed",
			);
			throw error;
		}
	}

	/** 详情不存在是可预期的业务分支，单独记录，避免和系统异常混在一起。 */
	private logNotFound(operation: string, resource: "disease" | "drug"): void {
		this.logger.info(
			{
				event: "health-knowledge.read.not_found",
				operation,
				resource,
			},
			"Health knowledge item not found",
		);
	}

	private publicationOf(
		value: unknown,
	): { contentVersion: string } | undefined {
		if (!value || typeof value !== "object") return undefined;
		const publication = (value as { publication?: unknown }).publication;
		if (!publication || typeof publication !== "object") return undefined;
		const contentVersion = (publication as { contentVersion?: unknown })
			.contentVersion;
		return typeof contentVersion === "string" ? { contentVersion } : undefined;
	}

	private itemCountOf(value: unknown): number | undefined {
		if (!value || typeof value !== "object") return undefined;
		const items = (value as { items?: unknown }).items;
		return Array.isArray(items) ? items.length : undefined;
	}
}
