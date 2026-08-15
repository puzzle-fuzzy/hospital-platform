import { describe, expect, test } from "bun:test";
import type { OutboxEvent } from "./outbox";
import type {
	PaymentOrder,
	PaymentOrderRepository,
	PaymentQuote,
	PaymentQuoteRepository,
} from "./payment-order";
import {
	assertValidPaymentAmounts,
	InvalidPaymentAmountsError,
	PaymentIdempotencyConflictError,
	PaymentOrderService,
	PaymentQuoteExpiredError,
} from "./payment-order";

const amounts = {
	totalFen: 1000,
	insuranceFen: 700,
	cashFen: 300,
};

function createMemoryOrders(
	events: OutboxEvent[] = [],
): PaymentOrderRepository {
	const orders = new Map<string, PaymentOrder>();
	return {
		async findByOwnerAndIdempotencyKey(ownerUserId, idempotencyKey) {
			return [...orders.values()].find(
				(order) =>
					order.ownerUserId === ownerUserId &&
					order.idempotencyKey === idempotencyKey,
			);
		},
		async findByOwnerAndId(ownerUserId, orderId) {
			const order = orders.get(orderId);
			return order?.ownerUserId === ownerUserId ? order : undefined;
		},
		async insert(order, event) {
			events.push(event);
			orders.set(order.orderId, order);
			return order;
		},
		async update(order, expectedVersion, event) {
			const current = orders.get(order.orderId);
			if (!current || current.version !== expectedVersion) {
				throw new Error("Payment order version conflict");
			}
			events.push(event);
			orders.set(order.orderId, order);
			return order;
		},
	};
}

function createMemoryQuotes(seed: PaymentQuote): PaymentQuoteRepository {
	return {
		async findByOwnerAndId(ownerUserId, quoteId) {
			return seed.ownerUserId === ownerUserId && seed.quoteId === quoteId
				? seed
				: undefined;
		},
	};
}

describe("payment order domain", () => {
	test("validates integer amount split and rejects mismatch", () => {
		expect(assertValidPaymentAmounts(amounts)).toEqual(amounts);
		expect(() =>
			assertValidPaymentAmounts({
				totalFen: 1000,
				insuranceFen: 701,
				cashFen: 300,
			}),
		).toThrow(InvalidPaymentAmountsError);
	});

	test("reuses an idempotent order and rejects changed payload", async () => {
		const events: OutboxEvent[] = [];
		const service = new PaymentOrderService({
			orders: createMemoryOrders(events),
			now: () => new Date("2026-08-15T00:00:00.000Z"),
			createOrderId: () => "order-001",
		});
		const first = await service.create({
			ownerUserId: "user-001",
			patientId: "patient-001",
			idempotencyKey: "pay-key-001",
			amounts,
		});
		expect(events[0]).toMatchObject({
			eventId: "payment-order:order-001:created",
			eventName: "payment-order.created",
			aggregateId: "order-001",
		});
		const replay = await service.create({
			ownerUserId: "user-001",
			patientId: "patient-001",
			idempotencyKey: "pay-key-001",
			amounts,
		});

		expect(replay).toEqual(first);
		expect(
			service.create({
				ownerUserId: "user-001",
				patientId: "patient-002",
				idempotencyKey: "pay-key-001",
				amounts,
			}),
		).rejects.toBeInstanceOf(PaymentIdempotencyConflictError);
	});

	test("default order ids stay within the external payment trade number limit", async () => {
		const service = new PaymentOrderService({
			orders: createMemoryOrders(),
		});
		const order = await service.create({
			ownerUserId: "user-default-id",
			patientId: "patient-default-id",
			idempotencyKey: "pay-key-default-id",
			amounts,
		});

		expect(order.orderId).toMatch(/^[0-9a-f]{32}$/);
	});

	test("allows only explicit state transitions and keeps version", async () => {
		const service = new PaymentOrderService({
			orders: createMemoryOrders(),
			createOrderId: () => "order-002",
		});
		const created = await service.create({
			ownerUserId: "user-002",
			patientId: "patient-002",
			idempotencyKey: "pay-key-002",
			amounts,
		});
		const authorized = await service.transition(
			"user-002",
			created.orderId,
			"authorized",
		);

		expect(authorized.state).toBe("authorized");
		expect(authorized.version).toBe(2);
		expect(
			service.transition("user-002", created.orderId, "completed"),
		).rejects.toThrow("Invalid payment transition");
	});

	test("creates from an unexpired server quote", async () => {
		const service = new PaymentOrderService({
			orders: createMemoryOrders(),
			quotes: createMemoryQuotes({
				quoteId: "quote-001",
				ownerUserId: "user-003",
				patientId: "patient-003",
				amounts,
				expiresAt: "2026-08-15T00:10:00.000Z",
				source: "fixture",
			}),
			now: () => new Date("2026-08-15T00:00:00.000Z"),
			createOrderId: () => "order-003",
		});

		const order = await service.createFromQuote({
			ownerUserId: "user-003",
			patientId: "patient-003",
			quoteId: "quote-001",
			idempotencyKey: "pay-key-003",
		});

		expect(order.amounts).toEqual(amounts);
		expect(order.state).toBe("created");
	});

	test("rejects an expired server quote", async () => {
		const service = new PaymentOrderService({
			orders: createMemoryOrders(),
			quotes: createMemoryQuotes({
				quoteId: "quote-002",
				ownerUserId: "user-004",
				patientId: "patient-004",
				amounts,
				expiresAt: "2026-08-14T23:59:00.000Z",
				source: "fixture",
			}),
			now: () => new Date("2026-08-15T00:00:00.000Z"),
		});

		expect(
			service.createFromQuote({
				ownerUserId: "user-004",
				patientId: "patient-004",
				quoteId: "quote-002",
				idempotencyKey: "pay-key-004",
			}),
		).rejects.toBeInstanceOf(PaymentQuoteExpiredError);
	});
});
