import { expect, test } from "bun:test";
import type { OutboxEvent, OutboxRepository } from "@hospital/domain";
import { createLogger } from "@hospital/observability";
import { MAX_OUTBOX_ATTEMPTS, OutboxWorker } from "./outbox-worker";

function createMemoryOutbox(seed: OutboxEvent): {
	repository: OutboxRepository;
	state: {
		processed: string[];
		retries: string[];
		manualReviews: string[];
		manualReviewAttempts: number[];
	};
} {
	let event: OutboxEvent | undefined = seed;
	const state = {
		processed: [] as string[],
		retries: [] as string[],
		manualReviews: [] as string[],
		manualReviewAttempts: [] as number[],
	};
	return {
		repository: {
			async append(nextEvent) {
				event = nextEvent;
			},
			async claimAvailable(now) {
				if (event?.status !== "pending" || new Date(event.availableAt) > now)
					return undefined;
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
					status: "pending",
					availableAt: nextAvailableAt.toISOString(),
					attempts: seed.attempts + 1,
				};
			},
			async markManualReview(eventId, _manualReviewAt, reason) {
				state.manualReviews.push(`${eventId}:${reason}`);
				state.manualReviewAttempts.push(seed.attempts + 1);
				event = undefined;
			},
		},
		state,
	};
}

const event: OutboxEvent = {
	eventId: "event-001",
	eventName: "payment-order.created",
	status: "pending",
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

test("outbox worker stops automatic retries at the manual review boundary", async () => {
	const memory = createMemoryOutbox({
		...event,
		attempts: MAX_OUTBOX_ATTEMPTS - 1,
	});
	const worker = new OutboxWorker(memory.repository, {
		"payment-order.created": async () => {
			throw new Error("synthetic failure");
		},
	});

	expect(await worker.runOnce(new Date("2026-08-15T00:00:00.000Z"))).toBe(
		"manual_review",
	);
	expect(memory.state.retries).toEqual([]);
	expect(memory.state.manualReviews).toEqual(["event-001:handler-failed"]);
	expect(memory.state.manualReviewAttempts).toEqual([MAX_OUTBOX_ATTEMPTS]);
});

test("outbox worker logs searchable event metadata", async () => {
	const memory = createMemoryOutbox(event);
	const lines: string[] = [];
	const logger = createLogger({
		service: "hospital-worker-test",
		environment: "test",
		level: "debug",
		destination: {
			write(chunk: string) {
				lines.push(chunk);
			},
		},
	});
	const worker = new OutboxWorker(
		memory.repository,
		{
			"payment-order.created": async () => {},
		},
		logger,
	);

	await worker.runOnce(new Date("2026-08-15T00:00:00.000Z"));

	const records = lines.map(
		(line) => JSON.parse(line) as Record<string, unknown>,
	);
	expect(records.map((record) => record.event)).toEqual([
		"worker.outbox.claimed",
		"worker.outbox.processed",
	]);
	expect(records[0]).toMatchObject({
		eventName: "payment-order.created",
		aggregateId: "order-001",
	});
});
