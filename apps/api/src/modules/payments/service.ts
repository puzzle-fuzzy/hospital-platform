import type { WechatPrepayPayload } from "@hospital/contracts";
import {
	PaymentCashPrepayNotAllowedError,
	type PaymentOrderService,
	type UserIdentityRepository,
	type WechatPaymentGateway,
} from "@hospital/domain";
import { createNoopLogger, type AppLogger } from "@hospital/observability";

export class PaymentIdentityNotFoundError extends Error {
	constructor() {
		super("Payment identity was not found for the current user");
		this.name = "PaymentIdentityNotFoundError";
	}
}

export type WechatPrepayServiceDependencies = {
	orders: PaymentOrderService;
	identityUsers: UserIdentityRepository;
	wechatPayment: WechatPaymentGateway;
	logger?: AppLogger;
};

/**
 * 微信预支付应用服务是一个很窄的 provider 边界：
 *
 * - openid 只从服务端身份仓储读取，不接受客户端提交；
 * - 只允许对医保结算后明确留下的 cash_pending 订单申请现金预支付；
 * - 返回 payParams 只是“可调起支付”，不迁移订单到 cash_paid 或 completed；
 * - 日志只记录内部订单、trace 和 provider request id，不记录 openid、prepay_id 或签名。
 */
export class WechatPrepayService {
	private readonly logger: AppLogger;

	constructor(private readonly dependencies: WechatPrepayServiceDependencies) {
		this.logger = dependencies.logger ?? createNoopLogger();
	}

	async create(input: {
		ownerUserId: string;
		orderId: string;
		context: { traceId: string; idempotencyKey: string };
	}): Promise<WechatPrepayPayload["data"]> {
		const order = await this.dependencies.orders.get(
			input.ownerUserId,
			input.orderId,
		);
		if (order.state !== "cash_pending" || order.amounts.cashFen <= 0) {
			throw new PaymentCashPrepayNotAllowedError();
		}

		const identity = await this.dependencies.identityUsers.findByUserId(
			input.ownerUserId,
		);
		if (!identity) throw new PaymentIdentityNotFoundError();

		this.logger.info(
			{
				event: "payment.wechat_prepay.requested",
				orderId: order.orderId,
				traceId: input.context.traceId,
				cashFen: order.amounts.cashFen,
			},
			"Wechat prepay requested",
		);

		try {
			const result = await this.dependencies.wechatPayment.createJsapiOrder(
				{
					orderId: order.orderId,
					openid: identity.providerSubject,
					totalFen: order.amounts.cashFen,
				},
				input.context,
			);
			this.logger.info(
				{
					event: "payment.wechat_prepay.created",
					orderId: order.orderId,
					traceId: input.context.traceId,
					provider: result.trace.provider,
					operation: result.trace.operation,
					providerRequestId: result.trace.requestId,
				},
				"Wechat prepay parameters created",
			);
			return {
				orderId: order.orderId,
				state: order.state,
				payParams: result.payParams,
			};
		} catch (error) {
			this.logger.warn(
				{
					event: "payment.wechat_prepay.failed",
					orderId: order.orderId,
					traceId: input.context.traceId,
					errorName: error instanceof Error ? error.name : "UnknownError",
				},
				"Wechat prepay request failed",
			);
			throw error;
		}
	}
}
