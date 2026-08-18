import { Elysia, t } from "elysia";
import {
	ReportDetailResponse,
	ReportListResponse,
	success,
} from "@hospital/contracts";
import type { SessionTokenService } from "../auth/service";
import { adapterContextFromHeaders } from "../../plugins/request-context";
import { createRequestPrincipalResolver } from "../../plugins/request-authentication";
import type { ReportService } from "./service";

const ReportHeaders = t.Object({
	authorization: t.Optional(t.String({ maxLength: 512 })),
	"x-request-id": t.Optional(t.String({ maxLength: 128 })),
});

const ReportQuery = t.Object({
	patientId: t.String({ minLength: 1, maxLength: 128 }),
	startDate: t.String({ pattern: "^\\d{4}-\\d{2}-\\d{2}$" }),
	endDate: t.String({ pattern: "^\\d{4}-\\d{2}-\\d{2}$" }),
	kind: t.Optional(
		t.Union([t.Literal("laboratory"), t.Literal("imaging"), t.Literal("ecg")]),
	),
});

const ReportDetailQuery = t.Object({
	patientId: t.String({ minLength: 1, maxLength: 128 }),
});

/** 报告接口只接受内部 patientId，服务端负责 owner、patient 隔离和 provider lookup。 */
export function reportsModule(
	reportService: ReportService,
	sessions: SessionTokenService,
) {
	const authentication = createRequestPrincipalResolver(sessions);
	return new Elysia({ name: "reports-module" })
		.onTransform({ as: "local" }, authentication.authenticate)
		.get(
			"/reports/:reportId",
			async ({ request, headers, params, query }) => {
				const principal = await authentication.get(request);
				return success(
					await reportService.detail(
						principal.userId,
						query.patientId,
						params.reportId,
						adapterContextFromHeaders(headers),
					),
				);
			},
			{
				params: t.Object({
					reportId: t.String({ minLength: 1, maxLength: 128 }),
				}),
				headers: ReportHeaders,
				query: ReportDetailQuery,
				response: { 200: ReportDetailResponse },
				tags: ["reports"],
			},
		)
		.get(
			"/reports",
			async ({ request, headers, query }) => {
				const principal = await authentication.get(request);
				const { patientId, ...reportQuery } = query;
				return success(
					await reportService.list(
						principal.userId,
						patientId,
						reportQuery,
						adapterContextFromHeaders(headers),
					),
				);
			},
			{
				headers: ReportHeaders,
				query: ReportQuery,
				response: { 200: ReportListResponse },
				tags: ["reports"],
			},
		);
}

export {
	ReportPatientNotFoundError,
	ReportNotFoundError,
	ReportQueryError,
	ReportService,
} from "./service";
