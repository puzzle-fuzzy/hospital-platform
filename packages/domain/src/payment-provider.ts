import type { OutboxEvent } from "./outbox";

/** outbox event_id 为 96 字节；前缀占用空间后通知 id 必须保持在 64 字符内。 */
const MAX_WECHAT_NOTIFICATION_ID_LENGTH = 64;

/**
 * 当前只接受微信支付成功通知。
 *
 * 关闭、撤销和支付中状态由后续查单补偿统一确认，避免把不完整的回调
 * 字段直接当成订单失败或成功事实。
 */
export type WechatPaymentNotification = {
	notificationId: string;
	eventType: "TRANSACTION.SUCCESS";
	orderId: string;
	tradeState: "SUCCESS";
	totalFen: number;
	providerTransactionId: string;
	receivedAt: string;
};

export type WechatPaymentNotificationRecordResult = {
	status: "inserted" | "duplicate";
	notification: WechatPaymentNotification;
};

/**
 * 微信通知事实必须和入站 outbox 在同一个持久化事务中提交。
 * provider 重试时返回 duplicate，但不能再次制造业务事件。
 */
export interface WechatPaymentNotificationRepository {
	record(
		notification: WechatPaymentNotification,
		event: OutboxEvent,
	): Promise<WechatPaymentNotificationRecordResult>;
}

export class PaymentNotificationConflictError extends Error {
	constructor() {
		super("Wechat payment notification conflicts with an existing event");
		this.name = "PaymentNotificationConflictError";
	}
}

/**
 * 入站 outbox 只携带可审计的内部摘要，不携带 APIv3 密钥、原始 resource、
 * payer 信息或任何小程序调起签名。
 */
export function createWechatPaymentNotificationEvent(
	notification: WechatPaymentNotification,
): OutboxEvent {
	if (
		!notification.notificationId ||
		notification.notificationId.length > MAX_WECHAT_NOTIFICATION_ID_LENGTH
	) {
		throw new Error("Wechat payment notification id is too long");
	}
	return {
		eventId: `wechat-payment-notification:${notification.notificationId}`,
		eventName: "payment.wechat-notification.received",
		aggregateId: notification.orderId,
		payload: {
			notificationId: notification.notificationId,
			eventType: notification.eventType,
			orderId: notification.orderId,
			tradeState: notification.tradeState,
			totalFen: notification.totalFen,
			providerTransactionId: notification.providerTransactionId,
			receivedAt: notification.receivedAt,
		},
		occurredAt: notification.receivedAt,
		availableAt: notification.receivedAt,
		attempts: 0,
	};
}
