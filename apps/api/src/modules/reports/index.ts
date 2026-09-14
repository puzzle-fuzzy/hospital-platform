import {
	ReportDetailResponse,
	ReportListResponse,
	success,
} from "@hospital/contracts";
import { Elysia, t } from "elysia";
import { createRequestPrincipalResolver } from "../../plugins/request-authentication";
import { adapterContextFromHeaders } from "../../plugins/request-context";
import type { SessionTokenService } from "../auth/service";
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
		t.Union([
			t.Literal("laboratory"),
			t.Literal("imaging"),
			t.Literal("ecg"),
			t.Literal("peis"),
		]),
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
			"/reports/:reportId/attachments/:attachmentId",
			async ({ request, headers, params, query }) => {
				const principal = await authentication.get(request);
				const attachment = await reportService.attachment(
					principal.userId,
					query.patientId,
					params.reportId,
					params.attachmentId,
					adapterContextFromHeaders(headers),
				);
				// 复制为独立 ArrayBuffer，避免 Node 类型中的 SharedArrayBuffer 联合
				// 被误判为 Web Response 不支持的 BodyInit。
				return new Response(Uint8Array.from(attachment.body).buffer, {
					headers: {
						"content-type": attachment.contentType,
						"content-disposition": "inline",
						"cache-control": "no-store",
						"x-content-type-options": "nosniff",
					},
				});
			},
			{
				params: t.Object({
					reportId: t.String({ minLength: 1, maxLength: 128 }),
					attachmentId: t.String({ minLength: 1, maxLength: 128 }),
				}),
				headers: ReportHeaders,
				query: ReportDetailQuery,
				tags: ["reports"],
			},
		)
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
	ReportNotFoundError,
	ReportPatientNotFoundError,
	ReportQueryError,
	ReportService,
} from "./service";
