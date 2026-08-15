import type {
	OutboxEvent,
	OutboxEventName,
	OutboxHandler,
	OutboxRepository,
} from "@hospital/domain";
import { createNoopLogger, type AppLogger } from "@hospital/observability";

/** 指数退避上限，避免 provider 故障时 worker 持续高频重试。 */
const MAX_RETRY_DELAY_MS = 15 * 60 * 1000;
/** 第一次失败后的基础退避时间；真实部署可在配置层覆盖。 */
const BASE_RETRY_DELAY_MS = 1000;

export type OutboxWorkerResult = "idle" | "processed" | "retry_scheduled";

function retryDelayMs(attempts: number): number {
	return Math.min(
		MAX_RETRY_DELAY_MS,
		BASE_RETRY_DELAY_MS * 2 ** Math.max(0, attempts - 1),
	);
}

/**
 * worker 只消费 outbox 事件并调度 handler；它不把 provider 成功写成订单成功。
 * 具体医保、微信支付和 HIS handler 仍按 adapter 证据逐个接入；当前只接入安全的微信通知事实 handler。
 */
export class OutboxWorker {
	constructor(
		private readonly repository: OutboxRepository,
		private readonly handlers: Partial<Record<OutboxEventName, OutboxHandler>>,
		private readonly logger: AppLogger = createNoopLogger(),
	) {}

	async runOnce(now = new Date()): Promise<OutboxWorkerResult> {
		const event = await this.repository.claimAvailable(now);
		if (!event) return "idle";
		this.logger.debug(
			{
				event: "worker.outbox.claimed",
				eventId: event.eventId,
				eventName: event.eventName,
				aggregateId: event.aggregateId,
				attempts: event.attempts,
			},
			"Outbox event claimed",
		);

		const handler = this.handlers[event.eventName];
		if (!handler) {
			await this.scheduleRetry(event, now, "handler-not-configured");
			this.logger.warn(
				{
					event: "worker.outbox.retry_scheduled",
					eventId: event.eventId,
					eventName: event.eventName,
					aggregateId: event.aggregateId,
					reason: "handler-not-configured",
				},
				"Outbox handler is not configured",
			);
			return "retry_scheduled";
		}

		try {
			await handler(event);
			await this.repository.markProcessed(event.eventId, now);
			this.logger.info(
				{
					event: "worker.outbox.processed",
					eventId: event.eventId,
					eventName: event.eventName,
					aggregateId: event.aggregateId,
				},
				"Outbox event processed",
			);
			return "processed";
		} catch {
			await this.scheduleRetry(event, now, "handler-failed");
			this.logger.warn(
				{
					event: "worker.outbox.retry_scheduled",
					eventId: event.eventId,
					eventName: event.eventName,
					aggregateId: event.aggregateId,
					reason: "handler-failed",
				},
				"Outbox handler failed",
			);
			return "retry_scheduled";
		}
	}

	private async scheduleRetry(
		event: OutboxEvent,
		now: Date,
		reason: string,
	): Promise<void> {
		const nextAvailableAt = new Date(
			now.getTime() + retryDelayMs(event.attempts + 1),
		);
		await this.repository.markRetry(event.eventId, nextAvailableAt, reason);
	}
}
