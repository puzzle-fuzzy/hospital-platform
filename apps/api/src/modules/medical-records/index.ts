import {
	OutpatientMedicalRecordListResponse,
	success,
} from "@hospital/contracts";
import { Elysia, t } from "elysia";
import { createRequestPrincipalResolver } from "../../plugins/request-authentication";
import { adapterContextFromHeaders } from "../../plugins/request-context";
import type { SessionTokenService } from "../auth/service";
import type { OutpatientMedicalRecordService } from "./service";

const MedicalRecordHeaders = t.Object({
	authorization: t.Optional(t.String({ maxLength: 512 })),
	"x-request-id": t.Optional(t.String({ maxLength: 128 })),
});

const DatePattern = "^\\d{4}-\\d{2}-\\d{2}$";

/** 门诊病历只接受内部 patientId 和固定日期窗口，Provider 患者号由服务端映射。 */
const MedicalRecordQuery = t.Object({
	patientId: t.String({ minLength: 1, maxLength: 128 }),
	startDate: t.String({ pattern: DatePattern }),
	endDate: t.String({ pattern: DatePattern }),
});

export function medicalRecordsModule(
	service: OutpatientMedicalRecordService,
	sessions: SessionTokenService,
) {
	const authentication = createRequestPrincipalResolver(sessions);
	return new Elysia({ name: "medical-records-module" })
		.onTransform({ as: "local" }, authentication.authenticate)
		.get(
			"/medical-records",
			async ({ request, headers, query }) => {
				const principal = await authentication.get(request);
				const { patientId, ...recordQuery } = query;
				return success(
					await service.list(
						principal.userId,
						patientId,
						recordQuery,
						adapterContextFromHeaders(headers),
					),
				);
			},
			{
				headers: MedicalRecordHeaders,
				query: MedicalRecordQuery,
				response: { 200: OutpatientMedicalRecordListResponse },
				tags: ["medical-records"],
			},
		);
}

export {
	MedicalRecordPatientNotFoundError,
	MedicalRecordQueryError,
	OutpatientMedicalRecordService,
} from "./service";
