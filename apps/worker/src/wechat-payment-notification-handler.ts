import type {
	OutboxEvent,
	OutboxHandler,
	PaymentOrderService,
} from "@hospital/domain";
import { createNoopLogger, type AppLogger } from "@hospital/observability";

/**
 * 入站通知 outbox 的安全 payload 形状。
 *
 * 该类型只描述 API 层已经验签、解密和白名单映射后的事实；worker 不接受
 * 原始 provider resource，也不在异步消费阶段重复处理密文。
 */
type WechatPaymentNotificationEventPayload = {
	notificationId: string;
	eventType: "TRANSACTION.SUCCESS";
	orderId: string;
	tradeState: "SUCCESS";
	totalFen: number;
	providerTransactionId: string;
	receivedAt: string;
};

function requiredString(
	value: unknown,
	field: string,
	maxLength: number,
): string {
	if (
		typeof value !== "string" ||
		value.length === 0 ||
		value.length > maxLength
	) {
		throw new Error(`Invalid WeChat notification event field: ${field}`);
	}
	return value;
}

function parseNotificationPayload(
	event: OutboxEvent,
): WechatPaymentNotificationEventPayload {
	if (event.eventName !== "payment.wechat-notification.received") {
		throw new Error("Unexpected outbox event for WeChat notification handler");
	}
	const payload = event.payload;
	const orderId = requiredString(payload.orderId, "orderId", 128);
	if (orderId !== event.aggregateId) {
		throw new Error("WeChat notification order does not match aggregate");
	}
	if (payload.eventType !== "TRANSACTION.SUCCESS") {
		throw new Error("Unsupported WeChat notification event type");
	}
	if (payload.tradeState !== "SUCCESS") {
		throw new Error("Unsupported WeChat notification trade state");
	}
	if (
		typeof payload.totalFen !== "number" ||
		!Number.isSafeInteger(payload.totalFen) ||
		payload.totalFen <= 0
	) {
		throw new Error("Invalid WeChat notification amount");
	}

	return {
		notificationId: requiredString(
			payload.notificationId,
			"notificationId",
			64,
		),
		eventType: "TRANSACTION.SUCCESS",
		orderId,
		tradeState: "SUCCESS",
		totalFen: payload.totalFen,
		providerTransactionId: requiredString(
			payload.providerTransactionId,
			"providerTransactionId",
			128,
		),
		receivedAt: requiredString(payload.receivedAt, "receivedAt", 64),
	};
}

/**
 * 创建微信成功通知的 outbox handler。
 *
 * 处理顺序是“读取安全事实 -> 订单金额/状态/version 校验 -> domain 迁移”。
 * outbox 只有在 handler 完成后才会标记 processed，因此进程崩溃或数据库冲突
 * 会由通用 outbox worker 重试，而不会丢失通知事实。
 */
export function createWechatPaymentNotificationHandler(options: {
	orders: PaymentOrderService;
	logger?: AppLogger;
}): OutboxHandler {
	const logger = options.logger ?? createNoopLogger();
	return async (event) => {
		const notification = parseNotificationPayload(event);
		const reconciliation = await options.orders.reconcileWechatPayment({
			orderId: notification.orderId,
			state: "cash_paid",
			totalFen: notification.totalFen,
			trace: {
				provider: "wechat-pay",
				operation: "payment-notification",
				requestId: notification.notificationId,
				providerOrderId: notification.providerTransactionId,
			},
		});

		logger.info(
			{
				event: "worker.payment.wechat_notification.reconciled",
				eventId: event.eventId,
				orderId: notification.orderId,
				notificationId: notification.notificationId,
				providerTransactionId: notification.providerTransactionId,
				outcome: reconciliation.outcome,
				orderState: reconciliation.order.state,
			},
			"Wechat payment notification reconciled",
		);
	};
}
