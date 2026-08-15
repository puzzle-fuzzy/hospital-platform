import {
	HealthKnowledgeCatalogResponse,
	HealthKnowledgeDiseaseDetailResponse,
	HealthKnowledgeDiseaseListResponse,
	HealthKnowledgeDrugDetailResponse,
	HealthKnowledgeSymptomListResponse,
	success,
} from "@hospital/contracts";
import { Elysia, t } from "elysia";
import { requirePrincipal, type SessionTokenService } from "../auth/service";
import type { HealthKnowledgeService } from "./service";

const HealthKnowledgeHeaders = t.Object({
	authorization: t.Optional(t.String({ maxLength: 512 })),
	"x-request-id": t.Optional(t.String({ maxLength: 128 })),
});

const KnowledgeIdParams = t.Object({
	partId: t.String({ minLength: 1, maxLength: 128 }),
});

const SymptomQuery = t.Object({
	symptomIds: t.Array(t.String({ minLength: 1, maxLength: 128 }), {
		minItems: 1,
		maxItems: 10,
	}),
});

/**
 * 健康知识保留旧项目的患者端路径语义，但所有结果改用新平台 contract。
 * 路由只读且需要平台会话；它不开放内容写入、不接受 provider id，也不调用 AI。
 */
export function healthKnowledgeModule(
	service: HealthKnowledgeService,
	sessions: SessionTokenService,
) {
	const authorize = (authorization: string | undefined) =>
		requirePrincipal(authorization, sessions);

	return new Elysia({ name: "health-knowledge-module" })
		.get(
			"/knowledge/health/part/list",
			async ({ headers }) => {
				await authorize(headers.authorization);
				return success(await service.listCatalog("part"));
			},
			{
				headers: HealthKnowledgeHeaders,
				response: { 200: HealthKnowledgeCatalogResponse },
				tags: ["knowledge"],
			},
		)
		.get(
			"/knowledge/health/crowd/list",
			async ({ headers }) => {
				await authorize(headers.authorization);
				return success(await service.listCatalog("crowd"));
			},
			{
				headers: HealthKnowledgeHeaders,
				response: { 200: HealthKnowledgeCatalogResponse },
				tags: ["knowledge"],
			},
		)
		.get(
			"/knowledge/health/department/list",
			async ({ headers }) => {
				await authorize(headers.authorization);
				return success(await service.listCatalog("department"));
			},
			{
				headers: HealthKnowledgeHeaders,
				response: { 200: HealthKnowledgeCatalogResponse },
				tags: ["knowledge"],
			},
		)
		.get(
			"/knowledge/health/symptoms/list/part/:partId",
			async ({ headers, params }) => {
				await authorize(headers.authorization);
				return success(await service.listSymptomsByPart(params.partId));
			},
			{
				headers: HealthKnowledgeHeaders,
				params: KnowledgeIdParams,
				response: { 200: HealthKnowledgeSymptomListResponse },
				tags: ["knowledge"],
			},
		)
		.get(
			"/knowledge/health/disease/list/part/:partId",
			async ({ headers, params }) => {
				await authorize(headers.authorization);
				return success(
					await service.listDiseasesByRelation({
						kind: "part",
						id: params.partId,
					}),
				);
			},
			{
				headers: HealthKnowledgeHeaders,
				params: KnowledgeIdParams,
				response: { 200: HealthKnowledgeDiseaseListResponse },
				tags: ["knowledge"],
			},
		)
		.get(
			"/knowledge/health/disease/list/crowd/:crowdId",
			async ({ headers, params }) => {
				await authorize(headers.authorization);
				return success(
					await service.listDiseasesByRelation({
						kind: "crowd",
						id: params.crowdId,
					}),
				);
			},
			{
				headers: HealthKnowledgeHeaders,
				params: t.Object({
					crowdId: t.String({ minLength: 1, maxLength: 128 }),
				}),
				response: { 200: HealthKnowledgeDiseaseListResponse },
				tags: ["knowledge"],
			},
		)
		.get(
			"/knowledge/health/disease/list/department/:departmentId",
			async ({ headers, params }) => {
				await authorize(headers.authorization);
				return success(
					await service.listDiseasesByRelation({
						kind: "department",
						id: params.departmentId,
					}),
				);
			},
			{
				headers: HealthKnowledgeHeaders,
				params: t.Object({
					departmentId: t.String({ minLength: 1, maxLength: 128 }),
				}),
				response: { 200: HealthKnowledgeDiseaseListResponse },
				tags: ["knowledge"],
			},
		)
		.get(
			"/knowledge/health/disease/list/symptoms",
			async ({ headers, query }) => {
				await authorize(headers.authorization);
				return success(await service.listDiseasesBySymptoms(query.symptomIds));
			},
			{
				headers: HealthKnowledgeHeaders,
				query: SymptomQuery,
				response: { 200: HealthKnowledgeDiseaseListResponse },
				tags: ["knowledge"],
			},
		)
		.get(
			"/knowledge/health/disease/detail/:diseaseId",
			async ({ headers, params }) => {
				await authorize(headers.authorization);
				return success(await service.getDiseaseDetail(params.diseaseId));
			},
			{
				headers: HealthKnowledgeHeaders,
				params: t.Object({
					diseaseId: t.String({ minLength: 1, maxLength: 128 }),
				}),
				response: { 200: HealthKnowledgeDiseaseDetailResponse },
				tags: ["knowledge"],
			},
		)
		.get(
			"/knowledge/health/drug/detail/:drugId",
			async ({ headers, params }) => {
				await authorize(headers.authorization);
				return success(await service.getDrugDetail(params.drugId));
			},
			{
				headers: HealthKnowledgeHeaders,
				params: t.Object({
					drugId: t.String({ minLength: 1, maxLength: 128 }),
				}),
				response: { 200: HealthKnowledgeDrugDetailResponse },
				tags: ["knowledge"],
			},
		);
}

export {
	HealthKnowledgeNotFoundError,
	HealthKnowledgeService,
} from "./service";
