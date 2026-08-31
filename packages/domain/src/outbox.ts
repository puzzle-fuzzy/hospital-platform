/** 当前阶段只允许内部业务事件；provider 调用不得从 HTTP 请求同步触发。 */
export type OutboxEventName =
	| "payment-order.created"
	| "payment-order.state-changed"
	| "payment.wechat-notification.received";

/**
 * outbox 的终态必须持久化，不能仅用“很远的下次执行时间”伪装人工接管。
 * manual_review 会停止自动 claim，等待运维核对后通过受控工具重新处理。
 */
export type OutboxEventStatus = "pending" | "processed" | "manual_review";

/** 持久化后的 outbox 事件；payload 不应包含密钥或未经脱敏的 provider 报文。 */
export type OutboxEvent = {
	eventId: string;
	eventName: OutboxEventName;
	status: OutboxEventStatus;
	aggregateId: string;
	payload: Readonly<Record<string, unknown>>;
	occurredAt: string;
	availableAt: string;
	attempts: number;
	manualReviewAt?: string;
};

/**
 * outbox 端口要求写入、claim、成功确认、失败重试和人工接管分开，便于数据库事务实现。
 * manual_review 事件不会被普通 worker 自动领取，避免永久重试和 provider 风暴。
 */
export interface OutboxRepository {
	append(event: OutboxEvent): Promise<void>;
	claimAvailable(now: Date): Promise<OutboxEvent | undefined>;
	markProcessed(eventId: string, processedAt: Date): Promise<void>;
	markRetry(
		eventId: string,
		nextAvailableAt: Date,
		reason: string,
	): Promise<void>;
	markManualReview(
		eventId: string,
		manualReviewAt: Date,
		reason: string,
	): Promise<void>;
}

export type OutboxHandler = (event: OutboxEvent) => Promise<void>;
