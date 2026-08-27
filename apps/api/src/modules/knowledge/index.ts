import {
	HealthKnowledgeCatalogResponse,
	HealthKnowledgeDiseaseDetailResponse,
	HealthKnowledgeDiseaseListResponse,
	HealthKnowledgeDrugDetailResponse,
	HealthKnowledgeSymptomListResponse,
	success,
} from "@hospital/contracts";
import { HealthKnowledgeValidationError } from "@hospital/domain";
import { Elysia, t } from "elysia";
import { createRequestPrincipalResolver } from "../../plugins/request-authentication";
import type { SessionTokenService } from "../auth/service";
import type { HealthKnowledgeService } from "./service";

const HealthKnowledgeHeaders = t.Object({
	authorization: t.Optional(t.String({ maxLength: 512 })),
	"x-request-id": t.Optional(t.String({ maxLength: 128 })),
});

function rejectUnexpectedQuery(request: Request): void {
	const keys = [...new URL(request.url).searchParams.keys()];
	if (keys.length > 0) {
		// 查询参数校验必须放在 handler 中、身份校验之后：不能因为用户拼错
		// 参数就绕过统一的 401 语义，也不能让未知参数进入未来的业务分支。
		throw new HealthKnowledgeValidationError("invalid_query");
	}
}

const KnowledgeIdParams = t.Object({
	partId: t.String({ minLength: 1, maxLength: 128 }),
});

/**
 * 新平台 HTTP contract 统一使用 camelCase；旧 FastAPI 的 `symptoms_ids` 只
 * 保留在迁移映射中，不在新路由里同时猜测两个参数。这样客户端拼错参数时
 * 会明确失败，避免“兼容成功”却无法判断实际调用的是哪套查询语义。
 */
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
	const authentication = createRequestPrincipalResolver(sessions);

	return (
		new Elysia({ name: "health-knowledge-module" })
			// 认证必须在 Elysia schema 校验前完成；否则未登录请求携带错误 query
			// 时会先得到 400，既不符合统一鉴权语义，也会暴露路由校验细节。
			.onTransform({ as: "local" }, authentication.authenticate)
			.get(
				"/knowledge/health/part/list",
				async ({ request }) => {
					await authentication.get(request);
					rejectUnexpectedQuery(request);
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
				async ({ request }) => {
					await authentication.get(request);
					rejectUnexpectedQuery(request);
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
				async ({ request }) => {
					await authentication.get(request);
					rejectUnexpectedQuery(request);
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
				async ({ params, request }) => {
					await authentication.get(request);
					rejectUnexpectedQuery(request);
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
				async ({ params, request }) => {
					await authentication.get(request);
					rejectUnexpectedQuery(request);
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
				async ({ params, request }) => {
					await authentication.get(request);
					rejectUnexpectedQuery(request);
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
				async ({ params, request }) => {
					await authentication.get(request);
					rejectUnexpectedQuery(request);
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
				async ({ query, request }) => {
					await authentication.get(request);
					return success(
						await service.listDiseasesBySymptoms(query.symptomIds),
					);
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
				async ({ params, request }) => {
					await authentication.get(request);
					rejectUnexpectedQuery(request);
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
				async ({ params, request }) => {
					await authentication.get(request);
					rejectUnexpectedQuery(request);
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
			)
	);
}

export {
	HealthKnowledgeNotFoundError,
	HealthKnowledgeService,
} from "./service";
