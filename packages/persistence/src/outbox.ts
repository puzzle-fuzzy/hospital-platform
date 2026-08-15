import type { OutboxEvent, OutboxRepository } from "@hospital/domain";

/** 仅用于本地 worker 测试；生产实现需要数据库 claim 锁和事务。 */
export function createInMemoryOutboxRepository(
	seed: readonly OutboxEvent[] = [],
): OutboxRepository {
	const events = new Map(seed.map((event) => [event.eventId, event]));
	const claimed = new Set<string>();
	const lastReasons = new Map<string, string>();

	return {
		async append(event) {
			events.set(event.eventId, event);
			claimed.delete(event.eventId);
		},
		async claimAvailable(now) {
			for (const event of events.values()) {
				if (
					!claimed.has(event.eventId) &&
					new Date(event.availableAt).getTime() <= now.getTime()
				) {
					claimed.add(event.eventId);
					return event;
				}
			}
			return undefined;
		},
		async markProcessed(eventId) {
			events.delete(eventId);
			claimed.delete(eventId);
		},
		async markRetry(eventId, nextAvailableAt, reason) {
			const event = events.get(eventId);
			if (!event) return;
			lastReasons.set(eventId, reason);
			events.set(eventId, {
				...event,
				availableAt: nextAvailableAt.toISOString(),
				attempts: event.attempts + 1,
			});
			claimed.delete(eventId);
		},
	};
}
