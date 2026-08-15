import { Elysia, t } from "elysia";
import {
	PaymentOrderCreateRequest,
	PaymentOrderResponse,
	success,
	WechatPrepayResponse,
	WechatPrepayStatusResponse,
} from "@hospital/contracts";
import type { PaymentOrderPayload } from "@hospital/contracts";
import type { PaymentOrder, PaymentOrderService } from "@hospital/domain";
import { adapterContextFromHeaders } from "../../plugins/request-context";
import { requirePrincipal, type SessionTokenService } from "../auth/service";
import type { WechatPrepayService } from "./service";

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

/** 支付订单 HTTP 模块只负责鉴权、输入校验和读模型映射。 */
export function paymentsModule(
	paymentOrders: PaymentOrderService,
	wechatPrepay: WechatPrepayService,
	sessions: SessionTokenService,
) {
	return new Elysia({ name: "payments-module" })
		.post(
			"/payments/orders",
			async ({ body, headers }) => {
				const principal = await requirePrincipal(
					headers.authorization,
					sessions,
				);
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
			async ({ headers, params }) => {
				const principal = await requirePrincipal(
					headers.authorization,
					sessions,
				);
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
			async ({ headers, params }) => {
				const principal = await requirePrincipal(
					headers.authorization,
					sessions,
				);
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
			async ({ headers, params }) => {
				const principal = await requirePrincipal(
					headers.authorization,
					sessions,
				);
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
