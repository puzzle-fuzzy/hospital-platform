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
import {
	HealthKnowledgeResultValidationError,
	HealthKnowledgeValidationError,
	normalizeHealthKnowledgeCatalogSnapshot,
	normalizeHealthKnowledgeDiseaseDocument,
	normalizeHealthKnowledgeDiseaseListSnapshot,
	normalizeHealthKnowledgeDrugDocument,
	normalizeHealthKnowledgeSymptomListSnapshot,
	validateHealthKnowledgeCatalogKind,
	validateHealthKnowledgeIdentifier,
	validateHealthKnowledgeSymptomIds,
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
		const snapshot = await this.read(
			"catalog",
			() => {
				// 分类决定 repository 查询的表/关系语义，不能只依赖编译期联合类型。
				validateHealthKnowledgeCatalogKind(kind);
				return this.dependencies.repository.listCatalog(kind);
			},
			normalizeHealthKnowledgeCatalogSnapshot,
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
		const snapshot = await this.read(
			"disease-relation",
			() => {
				if (
					typeof relation !== "object" ||
					relation === null ||
					Array.isArray(relation)
				) {
					throw new HealthKnowledgeValidationError("invalid_identifier");
				}
				validateHealthKnowledgeCatalogKind(relation.kind);
				validateHealthKnowledgeIdentifier(relation.id);
				return this.dependencies.repository.listDiseasesByRelation(relation);
			},
			normalizeHealthKnowledgeDiseaseListSnapshot,
		);
		return this.diseaseList(snapshot);
	}

	async listSymptomsByPart(
		partId: string,
	): Promise<HealthKnowledgeSymptomListResponsePayload["data"]> {
		const snapshot = await this.read(
			"symptoms-by-part",
			() => {
				validateHealthKnowledgeIdentifier(partId);
				return this.dependencies.repository.listSymptomsByPart(partId);
			},
			normalizeHealthKnowledgeSymptomListSnapshot,
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
		const snapshot = await this.read(
			"disease-symptoms",
			() => {
				if (!Array.isArray(symptomIds)) {
					throw new HealthKnowledgeValidationError("invalid_symptom_query");
				}
				validateHealthKnowledgeSymptomIds(symptomIds);
				return this.dependencies.repository.listDiseasesBySymptoms(symptomIds);
			},
			normalizeHealthKnowledgeDiseaseListSnapshot,
		);
		return this.diseaseList(snapshot);
	}

	async getDiseaseDetail(
		diseaseId: string,
	): Promise<HealthKnowledgeDiseaseDetailResponsePayload["data"]> {
		const document = await this.read(
			"disease-detail",
			() => {
				validateHealthKnowledgeIdentifier(diseaseId);
				return this.dependencies.repository.getDiseaseDetail(diseaseId);
			},
			(value) => normalizeHealthKnowledgeDiseaseDocument(value, diseaseId),
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
		const document = await this.read(
			"drug-detail",
			() => {
				validateHealthKnowledgeIdentifier(drugId);
				return this.dependencies.repository.getDrugDetail(drugId);
			},
			(value) => normalizeHealthKnowledgeDrugDocument(value, drugId),
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

	private async read<T>(
		operation: string,
		read: () => Promise<unknown>,
		normalize: (value: unknown) => T,
	): Promise<T> {
		this.logger.info(
			{
				event: "health-knowledge.read.requested",
				operation,
			},
			"Health knowledge read requested",
		);
		try {
			// 不能因为端口已经标注了 TypeScript 类型，就跳过运行时校验。
			// MySQL 行、回放数据和未来任务都可能携带未审计字段或坏值；先
			// 整批 fail-closed 并白名单投影，再计算日志元数据和返回结果。
			const result = normalize(await read());
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
					...(error instanceof HealthKnowledgeResultValidationError
						? { resultViolation: error.violation }
						: {}),
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
