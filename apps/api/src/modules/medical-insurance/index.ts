import {
	MedicalInsuranceAuthorizationContextResponse,
	MedicalInsuranceAuthorizeRequest,
	MedicalInsuranceAuthorizeResponse,
	MedicalInsuranceCancellationResponse,
	MedicalInsuranceCancelRequest,
	MedicalInsuranceOrderResponse,
	MedicalInsurancePluginPayResponse,
	MedicalInsuranceWechatPayResponse,
	success,
} from "@hospital/contracts";
import { Elysia, t } from "elysia";
import { createRequestPrincipalResolver } from "../../plugins/request-authentication";
import { adapterContextFromHeaders } from "../../plugins/request-context";
import type { SessionTokenService } from "../auth/service";
import type { MedicalInsurancePluginPaymentService } from "./plugin-payment-service";
import type { MedicalInsuranceRegistrationService } from "./registration-service";
import type { MedicalInsuranceNotificationService } from "./service";
import type { MedicalInsuranceWechatPaymentService } from "./wechat-payment-service";

type MedicalInsuranceWechatNotificationHandler = (input: {
	rawBody: Uint8Array;
	headers: Headers;
	receivedAt: string;
}) => Promise<void>;

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

const MedicalInsuranceAppointmentParams = t.Object({
	appointmentId: t.String({ minLength: 1, maxLength: 64 }),
});

/**
 * 医保流程拆成明确的服务端命令：授权、费用上传、结算、查单和支付中关单。
 * 这里不提供“快速挂号编排”入口，预约写入和取消由 appointments 模块独立负责。
 */
export function medicalInsuranceModule(
	registrationService: MedicalInsuranceRegistrationService,
	sessions: SessionTokenService,
	wechatPaymentService: MedicalInsuranceWechatPaymentService,
	/** 旧插件兼容入口；支付仍使用官方微信 APIv3，云健康只负责 .2/.29/.15/.5。 */
	pluginPaymentService: MedicalInsurancePluginPaymentService,
	notificationService?: MedicalInsuranceNotificationService,
	wechatNotificationHandler?: MedicalInsuranceWechatNotificationHandler,
) {
	const authentication = createRequestPrincipalResolver(sessions, [
		"/payments/medical-insurance/notifications",
		"/payments/medical-insurance/wechat-notifications",
	]);
	const routes = new Elysia({ name: "medical-insurance-module" })
		.onTransform({ as: "local" }, authentication.authenticate)
		.get(
			"/payments/medical-insurance/appointments/:appointmentId/authorization-context",
			async ({ request, headers, params }) => {
				const principal = await authentication.get(request);
				return success(
					await registrationService.authorizationContext({
						ownerUserId: principal.userId,
						appointmentId: params.appointmentId,
						context: adapterContextFromHeaders(headers),
					}),
				);
			},
			{
				headers: MedicalInsuranceQueryHeaders,
				params: MedicalInsuranceAppointmentParams,
				response: { 200: MedicalInsuranceAuthorizationContextResponse },
				tags: ["medical-insurance"],
			},
		)
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
			"/payments/medical-insurance/orders/:orderId/cashier",
			async ({ request, headers, params }) => {
				const principal = await authentication.get(request);
				return success(
					await registrationService.cashier({
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
		)
		.post(
			"/payments/medical-insurance/orders/:orderId/cashier-confirm",
			async ({ request, headers, params }) => {
				const principal = await authentication.get(request);
				return success(
					await registrationService.confirmCashierPayment({
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
			"/payments/medical-insurance/orders/:orderId/cancel",
			async ({ request, headers, params, body }) => {
				const principal = await authentication.get(request);
				return success(
					await registrationService.cancel({
						ownerUserId: principal.userId,
						orderId: params.orderId,
						reason: body.reason,
						context: adapterContextFromHeaders(headers),
					}),
				);
			},
			{
				headers: MedicalInsuranceCommandHeaders,
				params: MedicalInsuranceOrderParams,
				body: MedicalInsuranceCancelRequest,
				response: { 200: MedicalInsuranceCancellationResponse },
				tags: ["medical-insurance"],
			},
		)
		.post(
			"/payments/medical-insurance/orders/:orderId/wechat-pay",
			async ({ request, headers, params }) => {
				const principal = await authentication.get(request);
				return success(
					await wechatPaymentService.create({
						ownerUserId: principal.userId,
						orderId: params.orderId,
						context: adapterContextFromHeaders(headers),
					}),
				);
			},
			{
				headers: MedicalInsuranceCommandHeaders,
				params: MedicalInsuranceOrderParams,
				response: { 200: MedicalInsuranceWechatPayResponse },
				tags: ["medical-insurance"],
			},
		)
		.get(
			"/payments/medical-insurance/orders/:orderId/wechat-pay",
			async ({ request, headers, params }) => {
				const principal = await authentication.get(request);
				return success(
					await wechatPaymentService.query({
						ownerUserId: principal.userId,
						orderId: params.orderId,
						context: adapterContextFromHeaders(headers),
					}),
				);
			},
			{
				headers: MedicalInsuranceQueryHeaders,
				params: MedicalInsuranceOrderParams,
				response: { 200: MedicalInsuranceWechatPayResponse },
				tags: ["medical-insurance"],
			},
		)
		.post(
			"/payments/medical-insurance/orders/:orderId/plugin-pay",
			async ({ request, headers, params }) => {
				const principal = await authentication.get(request);
				return success(
					await pluginPaymentService.create({
						ownerUserId: principal.userId,
						orderId: params.orderId,
						context: adapterContextFromHeaders(headers),
					}),
				);
			},
			{
				headers: MedicalInsuranceCommandHeaders,
				params: MedicalInsuranceOrderParams,
				response: { 200: MedicalInsurancePluginPayResponse },
				tags: ["medical-insurance"],
			},
		)
		.get(
			"/payments/medical-insurance/orders/:orderId/plugin-pay",
			async ({ request, headers, params }) => {
				const principal = await authentication.get(request);
				return success(
					await pluginPaymentService.query({
						ownerUserId: principal.userId,
						orderId: params.orderId,
						context: adapterContextFromHeaders(headers),
					}),
				);
			},
			{
				headers: MedicalInsuranceQueryHeaders,
				params: MedicalInsuranceOrderParams,
				response: { 200: MedicalInsurancePluginPayResponse },
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

	const notificationRoutes = new Elysia({
		name: "medical-insurance-notifications",
	});
	if (notificationService) {
		notificationRoutes.post(
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
	}
	if (wechatNotificationHandler) {
		notificationRoutes.post(
			"/payments/medical-insurance/wechat-notifications",
			async ({ request }) => {
				await wechatNotificationHandler({
					rawBody: new Uint8Array(await request.arrayBuffer()),
					headers: request.headers,
					receivedAt: new Date().toISOString(),
				});
				return { code: "SUCCESS" as const, message: "成功" as const };
			},
			{
				response: {
					200: t.Object({
						code: t.Literal("SUCCESS"),
						message: t.Literal("成功"),
					}),
				},
				tags: ["medical-insurance"],
			},
		);
	}

	return notificationService || wechatNotificationHandler
		? routes.use(notificationRoutes)
		: routes;
}

export {
	MedicalInsuranceAppointmentNotFoundError,
	MedicalInsuranceOrderNotFoundError,
	MedicalInsuranceRegistrationInputError,
	MedicalInsuranceRegistrationService,
	type MedicalInsuranceRegistrationServiceDependencies,
} from "./registration-service";
