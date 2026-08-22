import { Elysia, t } from "elysia";
import {
	PaymentOrderCreateRequest,
	PaymentOrderResponse,
	success,
	WechatPrepayResponse,
	WechatPrepayStatusResponse,
} from "@hospital/contracts";
import { DependencyNotConfiguredError } from "@hospital/domain";
import type { PaymentOrderPayload } from "@hospital/contracts";
import type { PaymentOrder, PaymentOrderService } from "@hospital/domain";
import { adapterContextFromHeaders } from "../../plugins/request-context";
import type { SessionTokenService } from "../auth/service";
import { createRequestPrincipalResolver } from "../../plugins/request-authentication";
import type { WechatPrepayService } from "./service";
import type { WechatPaymentNotificationService } from "./notification-service";

const WechatPaymentNotificationAckResponse = t.Object({
	code: t.Literal("SUCCESS"),
	message: t.Literal("成功"),
});

/** 读取订单时只需要会话，不需要客户端重复提交幂等键。 */
const AuthenticatedHeaders = t.Object({
	authorization: t.Optional(t.String({ maxLength: 512 })),
});

/** 创建订单必须携带幂等键，服务端用它防止重复下单。 */
const CreateOrderHeaders = t.Object({
	authorization: t.Optional(t.String({ maxLength: 512 })),
	"idempotency-key": t.String({ minLength: 1, maxLength: 128 }),
});

/** 预支付请求使用独立幂等键，避免网络重试时丢失 provider 调用上下文。 */
const CreateWechatPrepayHeaders = t.Object({
	authorization: t.Optional(t.String({ maxLength: 512 })),
	"idempotency-key": t.String({ minLength: 1, maxLength: 128 }),
});

/** 路径参数只接受内部订单 id，不接受 provider 单号。 */
const PaymentOrderParams = t.Object({
	orderId: t.String({ minLength: 1, maxLength: 128 }),
});

/** 订单响应只映射安全读模型，避免领域字段随意透传到小程序。 */
function paymentOrderView(order: PaymentOrder): PaymentOrderPayload["data"] {
	return {
		orderId: order.orderId,
		patientId: order.patientId,
		amounts: order.amounts,
		state: order.state,
		version: order.version,
		createdAt: order.createdAt,
		updatedAt: order.updatedAt,
	};
}

/**
 * 支付闸门是订单写入、订单读取、预支付和微信通知的共同前置条件。
 *
 * `PaymentOrderService` 本身可以使用已配置的 MySQL 仓储创建订单，但这不等于
 * 微信支付、医保授权、结算回写和真实回调已经完成验收。若只把闸门放在
 * `WechatPrepayService`，支付配置关闭时仍可能先写入一笔无法完成的订单，
 * 小程序也会把“订单已创建”误认为费用链路已经可用。因此所有支付模块入口
 * 必须在进入仓储或 provider 之前共用这个 fail-closed 检查。
 */
function ensureWechatPaymentEnabled(enabled: boolean): void {
	if (!enabled) throw new DependencyNotConfiguredError("wechat-pay");
}

/** 支付订单 HTTP 模块只负责鉴权、输入校验和读模型映射。 */
export function paymentsModule(
	paymentOrders: PaymentOrderService,
	wechatPrepay: WechatPrepayService,
	wechatPaymentNotifications: WechatPaymentNotificationService,
	sessions: SessionTokenService,
	wechatPaymentEnabled: boolean,
) {
	const authentication = createRequestPrincipalResolver(sessions, [
		"/payments/wechat/notifications",
	]);
	return new Elysia({ name: "payments-module" })
		.onTransform({ as: "local" }, authentication.authenticate)
		.post(
			"/payments/wechat/notifications",
			async ({ request, headers }) => {
				// 通知入口虽由微信平台调用，也必须受同一个运行时闸门保护；
				// 关闭状态下不能验签、解密或写入通知去重表。
				ensureWechatPaymentEnabled(wechatPaymentEnabled);
				await wechatPaymentNotifications.receive({
					rawBody: new Uint8Array(await request.arrayBuffer()),
					headers: request.headers,
					...(headers["x-request-id"]
						? { traceId: headers["x-request-id"] }
						: {}),
				});
				// 微信通知成功响应使用 provider contract，而不是患者端 success/data 包装。
				return { code: "SUCCESS" as const, message: "成功" as const };
			},
			{
				response: { 200: WechatPaymentNotificationAckResponse },
				tags: ["payments"],
			},
		)
		.post(
			"/payments/orders",
			async ({ body, headers, request }) => {
				const principal = await authentication.get(request);
				// 认证先于支付闸门，保持未登录请求的统一 401 语义；闸门通过后
				// 才能读取 quote 或写入 payment-order/outbox。
				ensureWechatPaymentEnabled(wechatPaymentEnabled);
				const order = await paymentOrders.createFromQuote({
					ownerUserId: principal.userId,
					patientId: body.patientId,
					quoteId: body.quoteId,
					idempotencyKey: headers["idempotency-key"],
				});
				return success(paymentOrderView(order));
			},
			{
				body: PaymentOrderCreateRequest,
				headers: CreateOrderHeaders,
				response: { 200: PaymentOrderResponse },
				tags: ["payments"],
			},
		)
		.get(
			"/payments/orders/:orderId/wechat-prepay",
			async ({ headers, params, request }) => {
				const principal = await authentication.get(request);
				ensureWechatPaymentEnabled(wechatPaymentEnabled);
				return success(
					await wechatPrepay.read({
						ownerUserId: principal.userId,
						orderId: params.orderId,
						idempotencyKey: headers["idempotency-key"],
					}),
				);
			},
			{
				headers: CreateWechatPrepayHeaders,
				params: PaymentOrderParams,
				response: { 200: WechatPrepayStatusResponse },
				tags: ["payments"],
			},
		)
		.post(
			"/payments/orders/:orderId/wechat-prepay",
			async ({ headers, params, request }) => {
				const principal = await authentication.get(request);
				ensureWechatPaymentEnabled(wechatPaymentEnabled);
				return success(
					await wechatPrepay.create({
						ownerUserId: principal.userId,
						orderId: params.orderId,
						context: adapterContextFromHeaders(headers),
					}),
				);
			},
			{
				headers: CreateWechatPrepayHeaders,
				params: PaymentOrderParams,
				response: { 200: WechatPrepayResponse },
				tags: ["payments"],
			},
		)
		.get(
			"/payments/orders/:orderId",
			async ({ params, request }) => {
				const principal = await authentication.get(request);
				ensureWechatPaymentEnabled(wechatPaymentEnabled);
				const order = await paymentOrders.get(principal.userId, params.orderId);
				return success(paymentOrderView(order));
			},
			{
				headers: AuthenticatedHeaders,
				params: PaymentOrderParams,
				response: { 200: PaymentOrderResponse },
				tags: ["payments"],
			},
		);
}

export {
	PaymentIdentityNotFoundError,
	WechatPrepayService,
	type WechatPrepayServiceDependencies,
} from "./service";
export {
	WechatPaymentNotificationRejectedError,
	WechatPaymentNotificationService,
	type WechatPaymentNotificationDecoder,
} from "./notification-service";
