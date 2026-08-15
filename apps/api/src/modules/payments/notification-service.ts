import {
	createWechatPaymentNotificationEvent,
	DependencyNotConfiguredError,
	PaymentNotificationConflictError,
	type WechatPaymentNotification,
	type WechatPaymentNotificationRepository,
} from "@hospital/domain";
import { createNoopLogger, type AppLogger } from "@hospital/observability";

export type WechatPaymentNotificationDecoder = (input: {
	rawBody: Uint8Array;
	headers: Headers;
	receivedAt: string;
}) => WechatPaymentNotification;

export class WechatPaymentNotificationRejectedError extends Error {
	constructor() {
		super("Wechat payment notification was rejected");
		this.name = "WechatPaymentNotificationRejectedError";
	}
}

function sameNotification(
	left: WechatPaymentNotification,
	right: WechatPaymentNotification,
): boolean {
	return (
		left.notificationId === right.notificationId &&
		left.eventType === right.eventType &&
		left.orderId === right.orderId &&
		left.tradeState === right.tradeState &&
		left.totalFen === right.totalFen &&
		left.providerTransactionId === right.providerTransactionId
	);
}

/**
 * 微信支付通知入站编排器。
 *
 * decoder 负责 APIv3 验签、解密和字段白名单映射；本服务只负责生成安全
 * domain 事实、去重并要求 repository 与 outbox 同事务落库。
 */
export class WechatPaymentNotificationService {
	private readonly logger: AppLogger;
	private readonly now: () => Date;

	constructor(
		private readonly dependencies: {
			notifications: WechatPaymentNotificationRepository;
			decoder: WechatPaymentNotificationDecoder;
			logger?: AppLogger;
			now?: () => Date;
		},
	) {
		this.logger = dependencies.logger ?? createNoopLogger();
		this.now = dependencies.now ?? (() => new Date());
	}

	async receive(input: {
		rawBody: Uint8Array;
		headers: Headers;
		traceId?: string;
	}): Promise<"inserted" | "duplicate"> {
		const receivedAt = this.now().toISOString();
		let notification: WechatPaymentNotification;
		try {
			notification = this.dependencies.decoder({
				rawBody: input.rawBody,
				headers: input.headers,
				receivedAt,
			});
		} catch (error) {
			// 未配置属于环境边界错误，不能伪装成 provider 的非法通知。
			if (error instanceof DependencyNotConfiguredError) throw error;
			this.logger.warn(
				{
					event: "payment.wechat_notification.rejected",
					traceId: input.traceId,
					errorName: error instanceof Error ? error.name : "UnknownError",
				},
				"Wechat payment notification rejected",
			);
			throw new WechatPaymentNotificationRejectedError();
		}

		const event = createWechatPaymentNotificationEvent(notification);
		const recorded = await this.dependencies.notifications.record(
			notification,
			event,
		);
		if (
			recorded.status === "duplicate" &&
			!sameNotification(recorded.notification, notification)
		) {
			throw new PaymentNotificationConflictError();
		}

		this.logger.info(
			{
				event: "payment.wechat_notification.recorded",
				traceId: input.traceId,
				notificationId: notification.notificationId,
				orderId: notification.orderId,
				status: recorded.status,
				totalFen: notification.totalFen,
			},
			"Wechat payment notification recorded",
		);
		return recorded.status;
	}
}
