import {
	AppointmentDepartmentListResponse,
	AppointmentDepartmentTreeResponse,
	AppointmentRecordListResponse,
	AppointmentScheduleListResponse,
	AppointmentScheduleSourceListResponse,
	AppointmentCancellationResponse,
	AppointmentHoldRequest,
	AppointmentHoldResponse,
	AppointmentRegistrationRequest,
	AppointmentRegistrationResponse,
	success,
} from "@hospital/contracts";
import { Elysia, t } from "elysia";
import { createRequestPrincipalResolver } from "../../plugins/request-authentication";
import { adapterContextFromHeaders } from "../../plugins/request-context";
import type { SessionTokenService } from "../auth/service";
import type { AppointmentService } from "./service";
import type { AppointmentWriteService } from "./write-service";

/** 只接收平台链路所需的认证、幂等和请求关联头，不允许透传 Provider 头。 */
const AppointmentHeaders = t.Object({
	authorization: t.Optional(t.String({ maxLength: 512 })),
	"idempotency-key": t.Optional(t.String({ maxLength: 128 })),
	"x-request-id": t.Optional(t.String({ maxLength: 128 })),
});

const AppointmentCommandHeaders = t.Object({
	authorization: t.Optional(t.String({ maxLength: 512 })),
	"idempotency-key": t.String({
		minLength: 1,
		maxLength: 128,
		pattern: "^[A-Za-z0-9._:-]+$",
	}),
	"x-request-id": t.Optional(t.String({ maxLength: 128 })),
});

/** 预约业务使用自然日，不接受带时区或任意文本的日期。 */
const DatePattern = "^\\d{4}-\\d{2}-\\d{2}$";

/** 日期和过滤条件由 API 收窄，provider 不接收任意 query 参数透传。 */
const AppointmentScheduleQuery = t.Object({
	startDate: t.String({ pattern: DatePattern }),
	endDate: t.String({ pattern: DatePattern }),
	departmentId: t.Optional(t.String({ minLength: 1, maxLength: 128 })),
	doctorId: t.Optional(t.String({ minLength: 1, maxLength: 128 })),
});

/**
 * 三级可预约科室只接受一级/二级树中公开的二级 opaque ID；名称筛选由
 * service/adapter 从树中重新解析，不能让 HTTP query 进入 Provider。
 */
const AppointmentClinicDepartmentQuery = t.Object({
	parentDepartmentId: t.String({ minLength: 1, maxLength: 128 }),
});

/**
 * 记录查询只接受内部 patientId 和两个明确的业务范围；Provider 渠道码、
 * 患者号和其它原始参数不能从公网透传。在线范围需要日期，全部范围由
 * 服务端按旧端已核实语义查询完整历史，具体一致性由 service 再校验。
 */
const AppointmentRecordQuery = t.Object({
	patientId: t.String({ minLength: 1, maxLength: 128 }),
	scope: t.Optional(t.Union([t.Literal("online"), t.Literal("all")])),
	startDate: t.Optional(t.String({ pattern: DatePattern })),
	endDate: t.Optional(t.String({ pattern: DatePattern })),
});

/** 预约目录必须经过平台会话，provider 授权只存在服务端组合根。 */
export function appointmentsModule(
	appointmentService: AppointmentService,
	appointmentWrites: AppointmentWriteService,
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
		.post(
			"/appointments/holds",
			async ({ request, headers, body }) => {
				const principal = await authentication.get(request);
				return success(
					await appointmentWrites.hold({
						ownerUserId: principal.userId,
						patientId: body.patientId,
						scheduleId: body.scheduleId,
						sourceSerialNumber: body.sourceSerialNumber,
						context: adapterContextFromHeaders(headers),
					}),
				);
			},
			{
				headers: AppointmentCommandHeaders,
				body: AppointmentHoldRequest,
				response: { 200: AppointmentHoldResponse },
				tags: ["appointments"],
			},
		)
		.post(
			"/appointments/registrations",
			async ({ request, headers, body }) => {
				const principal = await authentication.get(request);
				return success(
					await appointmentWrites.register({
						ownerUserId: principal.userId,
						patientId: body.patientId,
						holdId: body.holdId,
						context: adapterContextFromHeaders(headers),
					}),
				);
			},
			{
				headers: AppointmentCommandHeaders,
				body: AppointmentRegistrationRequest,
				response: { 200: AppointmentRegistrationResponse },
				tags: ["appointments"],
			},
		)
		.post(
			"/appointments/registrations/:appointmentId/cancel",
			async ({ request, headers, params }) => {
				const principal = await authentication.get(request);
				return success(
					await appointmentWrites.cancel({
						ownerUserId: principal.userId,
						appointmentId: params.appointmentId,
						context: adapterContextFromHeaders(headers),
					}),
				);
			},
			{
				headers: AppointmentCommandHeaders,
				params: t.Object({
					appointmentId: t.String({ minLength: 1, maxLength: 64 }),
				}),
				response: { 200: AppointmentCancellationResponse },
				tags: ["appointments"],
			},
		)
		.get(
			"/appointments/department-tree",
			async ({ request, headers }) => {
				await authentication.get(request);
				return success(
					await appointmentService.listDepartmentTree(
						adapterContextFromHeaders(headers),
					),
				);
			},
			{
				headers: AppointmentHeaders,
				response: { 200: AppointmentDepartmentTreeResponse },
				tags: ["appointments"],
			},
		)
		.get(
			"/appointments/clinic-departments",
			async ({ request, headers, query }) => {
				await authentication.get(request);
				return success(
					await appointmentService.listClinicDepartments(
						query.parentDepartmentId,
						adapterContextFromHeaders(headers),
					),
				);
			},
			{
				headers: AppointmentHeaders,
				query: AppointmentClinicDepartmentQuery,
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
			"/appointments/schedules/:scheduleId/sources",
			async ({ request, headers, params }) => {
				await authentication.get(request);
				return success(
					await appointmentService.listScheduleSources(
						params.scheduleId,
						adapterContextFromHeaders(headers),
					),
				);
			},
			{
				headers: AppointmentHeaders,
				params: t.Object({
					scheduleId: t.String({ minLength: 1, maxLength: 128 }),
				}),
				response: { 200: AppointmentScheduleSourceListResponse },
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
export {
	AppointmentHoldExpiredError,
	AppointmentHoldNotFoundError,
	AppointmentRegistrationNotFoundError,
	AppointmentWriteInputError,
	AppointmentWritePatientNotFoundError,
	AppointmentWriteService,
	type AppointmentWriteServiceDependencies,
} from "./write-service";
