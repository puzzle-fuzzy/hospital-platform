import {
	AppointmentDepartmentListResponse,
	AppointmentRecordListResponse,
	AppointmentScheduleListResponse,
	success,
} from "@hospital/contracts";
import { Elysia, t } from "elysia";
import { adapterContextFromHeaders } from "../../plugins/request-context";
import type { SessionTokenService } from "../auth/service";
import { createRequestPrincipalResolver } from "../../plugins/request-authentication";
import type { AppointmentService } from "./service";

const AppointmentHeaders = t.Object({
	authorization: t.Optional(t.String({ maxLength: 512 })),
	"idempotency-key": t.Optional(t.String({ maxLength: 128 })),
	"x-request-id": t.Optional(t.String({ maxLength: 128 })),
});

const DatePattern = "^\\d{4}-\\d{2}-\\d{2}$";

/** 日期和过滤条件由 API 收窄，provider 不接收任意 query 参数透传。 */
const AppointmentScheduleQuery = t.Object({
	startDate: t.String({ pattern: DatePattern }),
	endDate: t.String({ pattern: DatePattern }),
	departmentId: t.Optional(t.String({ minLength: 1, maxLength: 128 })),
	doctorId: t.Optional(t.String({ minLength: 1, maxLength: 128 })),
});

/** 记录查询只接受内部 patientId 和有限日期范围，不能透传 provider 参数。 */
const AppointmentRecordQuery = t.Object({
	patientId: t.String({ minLength: 1, maxLength: 128 }),
	startDate: t.String({ pattern: DatePattern }),
	endDate: t.String({ pattern: DatePattern }),
});

/** 预约目录必须经过平台会话，provider 授权只存在服务端组合根。 */
export function appointmentsModule(
	appointmentService: AppointmentService,
	sessions: SessionTokenService,
) {
	const authentication = createRequestPrincipalResolver(sessions);
	return new Elysia({ name: "appointments-module" })
		.onTransform({ as: "local" }, authentication.authenticate)
		.get(
			"/appointments/departments",
			async ({ request, headers }) => {
				await authentication.get(request);
				return success(
					await appointmentService.listDepartments(
						adapterContextFromHeaders(headers),
					),
				);
			},
			{
				headers: AppointmentHeaders,
				response: { 200: AppointmentDepartmentListResponse },
				tags: ["appointments"],
			},
		)
		.get(
			"/appointments/schedules",
			async ({ request, headers, query }) => {
				await authentication.get(request);
				return success(
					await appointmentService.listSchedules(
						query,
						adapterContextFromHeaders(headers),
					),
				);
			},
			{
				headers: AppointmentHeaders,
				query: AppointmentScheduleQuery,
				response: { 200: AppointmentScheduleListResponse },
				tags: ["appointments"],
			},
		)
		.get(
			"/appointments/records",
			async ({ request, headers, query }) => {
				const principal = await authentication.get(request);
				const { patientId, ...recordQuery } = query;
				return success(
					await appointmentService.listRecords(
						principal.userId,
						patientId,
						recordQuery,
						adapterContextFromHeaders(headers),
					),
				);
			},
			{
				headers: AppointmentHeaders,
				query: AppointmentRecordQuery,
				response: { 200: AppointmentRecordListResponse },
				tags: ["appointments"],
			},
		);
}

export {
	AppointmentRecordPatientNotFoundError,
	AppointmentRecordQueryError,
	AppointmentScheduleQueryError,
	AppointmentService,
} from "./service";
