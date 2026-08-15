import { Elysia, t } from "elysia";
import { ReportListResponse, success } from "@hospital/contracts";
import { requirePrincipal, type SessionTokenService } from "../auth/service";
import { adapterContextFromHeaders } from "../../plugins/request-context";
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

/** 报告接口只接受内部 patientId，服务端负责 owner 隔离和 provider lookup。 */
export function reportsModule(
	reportService: ReportService,
	sessions: SessionTokenService,
) {
	return new Elysia({ name: "reports-module" }).get(
		"/reports",
		async ({ headers, query }) => {
			const principal = await requirePrincipal(headers.authorization, sessions);
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
	ReportQueryError,
	ReportService,
} from "./service";
