import { expect, test } from "bun:test";
import type { OutboxEvent, OutboxRepository } from "@hospital/domain";
import { OutboxWorker } from "./outbox-worker";

function createMemoryOutbox(seed: OutboxEvent): {
	repository: OutboxRepository;
	state: { processed: string[]; retries: string[] };
} {
	let event: OutboxEvent | undefined = seed;
	const state = { processed: [] as string[], retries: [] as string[] };
	return {
		repository: {
			async claimAvailable(now) {
				if (!event || new Date(event.availableAt) > now) return undefined;
				const claimed = event;
				event = undefined;
				return claimed;
			},
			async markProcessed(eventId) {
				state.processed.push(eventId);
			},
			async markRetry(eventId, nextAvailableAt, reason) {
				state.retries.push(`${eventId}:${reason}`);
				event = {
					...seed,
					availableAt: nextAvailableAt.toISOString(),
					attempts: seed.attempts + 1,
				};
			},
		},
		state,
	};
}

const event: OutboxEvent = {
	eventId: "event-001",
	eventName: "payment-order.created",
	aggregateId: "order-001",
	payload: { orderId: "order-001" },
	occurredAt: "2026-08-15T00:00:00.000Z",
	availableAt: "2026-08-15T00:00:00.000Z",
	attempts: 0,
};

test("outbox worker marks a handled event as processed", async () => {
	const memory = createMemoryOutbox(event);
	const worker = new OutboxWorker(memory.repository, {
		"payment-order.created": async (received) => {
			expect(received.aggregateId).toBe("order-001");
		},
	});

	expect(await worker.runOnce(new Date("2026-08-15T00:00:00.000Z"))).toBe(
		"processed",
	);
	expect(memory.state.processed).toEqual(["event-001"]);
});

test("outbox worker schedules a retry when a handler fails", async () => {
	const memory = createMemoryOutbox(event);
	const worker = new OutboxWorker(memory.repository, {
		"payment-order.created": async () => {
			throw new Error("synthetic failure");
		},
	});

	expect(await worker.runOnce(new Date("2026-08-15T00:00:00.000Z"))).toBe(
		"retry_scheduled",
	);
	expect(memory.state.retries).toEqual(["event-001:handler-failed"]);
});

test("outbox worker does not report success without a handler", async () => {
	const memory = createMemoryOutbox(event);
	const worker = new OutboxWorker(memory.repository, {});

	expect(await worker.runOnce(new Date("2026-08-15T00:00:00.000Z"))).toBe(
		"retry_scheduled",
	);
	expect(memory.state.processed).toHaveLength(0);
	expect(memory.state.retries).toEqual(["event-001:handler-not-configured"]);
});
