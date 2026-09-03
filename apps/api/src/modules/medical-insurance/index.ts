import {
	MedicalInsuranceAuthorizeRequest,
	MedicalInsuranceAuthorizeResponse,
	MedicalInsuranceOrderResponse,
	success,
} from "@hospital/contracts";
import { Elysia, t } from "elysia";
import { createRequestPrincipalResolver } from "../../plugins/request-authentication";
import { adapterContextFromHeaders } from "../../plugins/request-context";
import type { SessionTokenService } from "../auth/service";
import type { MedicalInsuranceRegistrationService } from "./registration-service";
import type { MedicalInsuranceNotificationService } from "./service";

/** 医保业务入口只允许平台会话和服务端生成的关联/幂等信息。 */
const MedicalInsuranceCommandHeaders = t.Object({
	authorization: t.Optional(t.String({ maxLength: 512 })),
	"idempotency-key": t.String({
		minLength: 1,
		maxLength: 128,
		pattern: "^[A-Za-z0-9._:-]+$",
	}),
	"x-request-id": t.Optional(t.String({ maxLength: 128 })),
});

const MedicalInsuranceQueryHeaders = t.Object({
	authorization: t.Optional(t.String({ maxLength: 512 })),
	"idempotency-key": t.Optional(
		t.String({ maxLength: 128, pattern: "^[A-Za-z0-9._:-]+$" }),
	),
	"x-request-id": t.Optional(t.String({ maxLength: 128 })),
});

const MedicalInsuranceOrderParams = t.Object({
	orderId: t.String({ minLength: 1, maxLength: 64 }),
});

/**
 * 医保流程拆成四个明确的服务端命令：授权、费用上传、结算、查单。
 * 这里不提供“快速挂号编排”入口，预约写入和取消由 appointments 模块独立负责。
 */
export function medicalInsuranceModule(
	registrationService: MedicalInsuranceRegistrationService,
	sessions: SessionTokenService,
	notificationService?: MedicalInsuranceNotificationService,
) {
	const authentication = createRequestPrincipalResolver(sessions, [
		"/payments/medical-insurance/notifications",
	]);
	const routes = new Elysia({ name: "medical-insurance-module" })
		.onTransform({ as: "local" }, authentication.authenticate)
		.post(
			"/payments/medical-insurance/authorize",
			async ({ request, headers, body }) => {
				const principal = await authentication.get(request);
				return success(
					await registrationService.authorize({
						ownerUserId: principal.userId,
						appointmentId: body.appointmentId,
						authCode: body.authCode,
						context: adapterContextFromHeaders(headers),
					}),
				);
			},
			{
				headers: MedicalInsuranceCommandHeaders,
				body: MedicalInsuranceAuthorizeRequest,
				response: { 200: MedicalInsuranceAuthorizeResponse },
				tags: ["medical-insurance"],
			},
		)
		.post(
			"/payments/medical-insurance/orders/:orderId/fees",
			async ({ request, headers, params }) => {
				const principal = await authentication.get(request);
				return success(
					await registrationService.uploadFees({
						ownerUserId: principal.userId,
						orderId: params.orderId,
						context: adapterContextFromHeaders(headers),
					}),
				);
			},
			{
				headers: MedicalInsuranceCommandHeaders,
				params: MedicalInsuranceOrderParams,
				response: { 200: MedicalInsuranceOrderResponse },
				tags: ["medical-insurance"],
			},
		)
		.post(
			"/payments/medical-insurance/orders/:orderId/settle",
			async ({ request, headers, params }) => {
				const principal = await authentication.get(request);
				return success(
					await registrationService.settle({
						ownerUserId: principal.userId,
						orderId: params.orderId,
						context: adapterContextFromHeaders(headers),
					}),
				);
			},
			{
				headers: MedicalInsuranceCommandHeaders,
				params: MedicalInsuranceOrderParams,
				response: { 200: MedicalInsuranceOrderResponse },
				tags: ["medical-insurance"],
			},
		)
		.get(
			"/payments/medical-insurance/orders/:orderId",
			async ({ request, headers, params }) => {
				const principal = await authentication.get(request);
				return success(
					await registrationService.query({
						ownerUserId: principal.userId,
						orderId: params.orderId,
						context: adapterContextFromHeaders(headers),
					}),
				);
			},
			{
				headers: MedicalInsuranceQueryHeaders,
				params: MedicalInsuranceOrderParams,
				response: { 200: MedicalInsuranceOrderResponse },
				tags: ["medical-insurance"],
			},
		);

	if (!notificationService) return routes;

	const notificationRoute = new Elysia({
		name: "medical-insurance-notification",
	}).post(
		"/payments/medical-insurance/notifications",
		async ({ request, headers }) => {
			const payload = (await request.json()) as Record<string, unknown>;
			return notificationService.receive({
				payload,
				context: adapterContextFromHeaders(headers),
			});
		},
		{
			headers: t.Object({
				"x-request-id": t.Optional(t.String({ maxLength: 128 })),
			}),
			response: {
				200: t.Object({
					success: t.Boolean(),
					message: t.String(),
				}),
			},
			tags: ["medical-insurance"],
		},
	);

	return routes.use(notificationRoute);
}

export {
	MedicalInsuranceAppointmentNotFoundError,
	MedicalInsuranceOrderNotFoundError,
	MedicalInsuranceRegistrationInputError,
	MedicalInsuranceRegistrationService,
	type MedicalInsuranceRegistrationServiceDependencies,
} from "./registration-service";
