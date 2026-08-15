/** 当前阶段只允许内部业务事件；provider 调用不得从 HTTP 请求同步触发。 */
export type OutboxEventName =
	| "payment-order.created"
	| "payment-order.state-changed";

/** 持久化后的 outbox 事件；payload 不应包含密钥或未经脱敏的 provider 报文。 */
export type OutboxEvent = {
	eventId: string;
	eventName: OutboxEventName;
	aggregateId: string;
	payload: Readonly<Record<string, unknown>>;
	occurredAt: string;
	availableAt: string;
	attempts: number;
};

/** outbox 端口要求 claim、成功确认和失败重试分开，便于数据库事务实现。 */
export interface OutboxRepository {
	claimAvailable(now: Date): Promise<OutboxEvent | undefined>;
	markProcessed(eventId: string, processedAt: Date): Promise<void>;
	markRetry(
		eventId: string,
		nextAvailableAt: Date,
		reason: string,
	): Promise<void>;
}

export type OutboxHandler = (event: OutboxEvent) => Promise<void>;
