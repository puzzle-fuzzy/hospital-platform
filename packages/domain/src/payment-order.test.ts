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
	PaymentOrderReadModelValidationError,
	PaymentQuoteExpiredError,
	PaymentQuoteReadModelValidationError,
	normalizePaymentOrderReadModel,
	normalizePaymentQuoteReadModel,
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
		async findById(orderId) {
			return orders.get(orderId);
		},
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
	test("重新投影订单读模型并丢弃未声明字段", () => {
		const normalized = normalizePaymentOrderReadModel({
			orderId: "order-read-001",
			ownerUserId: "user-read-001",
			patientId: "patient-read-001",
			idempotencyKey: "pay-read-001",
			amounts,
			state: "cash_pending",
			version: 4,
			createdAt: "2026-08-15T00:00:00.000Z",
			updatedAt: "2026-08-15T00:00:01.000Z",
			providerSecret: "must-not-cross-domain",
		});

		expect(normalized).not.toHaveProperty("providerSecret");
		expect(normalized.amounts).toEqual(amounts);
	});

	test("订单读模型损坏时不允许进入状态机", async () => {
		const service = new PaymentOrderService({
			orders: {
				async findById() {
					return {
						orderId: "order-invalid-001",
						ownerUserId: "user-invalid-001",
						patientId: "patient-invalid-001",
						idempotencyKey: "pay-invalid-001",
						amounts: { ...amounts, cashFen: 301 },
						state: "cash_pending",
						version: 4,
						createdAt: "2026-08-15T00:00:00.000Z",
						updatedAt: "2026-08-15T00:00:01.000Z",
					} as never;
				},
				async findByOwnerAndIdempotencyKey() {
					return undefined;
				},
				async findByOwnerAndId() {
					return undefined;
				},
				async insert() {
					throw new Error("not used");
				},
				async update() {
					throw new Error("must not update invalid order");
				},
			},
		});

		const error = await service
			.reconcileWechatPayment({
				orderId: "order-invalid-001",
				state: "cash_paid",
				totalFen: 300,
				trace: {
					provider: "wechat-pay",
					operation: "order-query",
					requestId: "payment-read-invalid-001",
				},
			})
			.catch((reason: unknown) => reason);
		expect(error).toBeInstanceOf(PaymentOrderReadModelValidationError);
		expect((error as PaymentOrderReadModelValidationError).violation).toBe(
			"amounts-invalid",
		);
	});

	test("报价读模型损坏时不能成为订单金额来源", () => {
		expect(() =>
			normalizePaymentQuoteReadModel({
				quoteId: "quote-invalid-001",
				ownerUserId: "user-invalid-001",
				patientId: "patient-invalid-001",
				amounts: { totalFen: 1000, insuranceFen: 700, cashFen: 301 },
				expiresAt: "2026-08-15T00:10:00.000Z",
				source: "fixture",
			}),
		).toThrow(PaymentQuoteReadModelValidationError);
	});

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

	test("reconciles a verified matching WeChat amount with provider evidence", async () => {
		const events: OutboxEvent[] = [];
		const service = new PaymentOrderService({
			orders: createMemoryOrders(events),
			createOrderId: () => "order-reconcile-001",
		});
		const created = await service.create({
			ownerUserId: "user-reconcile-001",
			patientId: "patient-reconcile-001",
			idempotencyKey: "pay-reconcile-001",
			amounts,
		});
		await service.transition(
			created.ownerUserId,
			created.orderId,
			"authorized",
		);
		await service.transition(
			created.ownerUserId,
			created.orderId,
			"pre_settled",
		);
		await service.transition(
			created.ownerUserId,
			created.orderId,
			"insurance_submitted",
		);
		await service.transition(
			created.ownerUserId,
			created.orderId,
			"insurance_settled",
		);
		await service.transition(
			created.ownerUserId,
			created.orderId,
			"cash_pending",
		);

		const result = await service.reconcileWechatPayment({
			orderId: created.orderId,
			state: "cash_paid",
			totalFen: 300,
			trace: {
				provider: "wechat-pay",
				operation: "order-query",
				requestId: "provider-query-reconcile-001",
			},
		});

		expect(result).toMatchObject({
			outcome: "cash_paid",
			order: { state: "cash_paid" },
		});
		expect(events.at(-1)?.payload).toMatchObject({
			providerEvidence: {
				reportedState: "cash_paid",
				totalFen: 300,
				requestId: "provider-query-reconcile-001",
			},
		});
	});

	test("moves a verified amount mismatch to awaiting confirmation", async () => {
		const service = new PaymentOrderService({
			orders: createMemoryOrders(),
			createOrderId: () => "order-reconcile-002",
		});
		const created = await service.create({
			ownerUserId: "user-reconcile-002",
			patientId: "patient-reconcile-002",
			idempotencyKey: "pay-reconcile-002",
			amounts,
		});
		for (const state of [
			"authorized",
			"pre_settled",
			"insurance_submitted",
			"insurance_settled",
			"cash_pending",
		] as const) {
			await service.transition(created.ownerUserId, created.orderId, state);
		}

		const result = await service.reconcileWechatPayment({
			orderId: created.orderId,
			state: "cash_paid",
			totalFen: 301,
			trace: {
				provider: "wechat-pay",
				operation: "order-query",
				requestId: "provider-query-reconcile-002",
			},
		});

		expect(result).toMatchObject({
			outcome: "awaiting_confirmation",
			order: { state: "awaiting_confirmation" },
		});
	});

	test("resolves awaiting confirmation after a later matching provider result", async () => {
		const service = new PaymentOrderService({
			orders: createMemoryOrders(),
			createOrderId: () => "order-reconcile-003",
		});
		const created = await service.create({
			ownerUserId: "user-reconcile-003",
			patientId: "patient-reconcile-003",
			idempotencyKey: "pay-reconcile-003",
			amounts,
		});
		for (const state of [
			"authorized",
			"pre_settled",
			"insurance_submitted",
			"insurance_settled",
			"cash_pending",
		] as const) {
			await service.transition(created.ownerUserId, created.orderId, state);
		}
		await service.reconcileWechatPayment({
			orderId: created.orderId,
			state: "cash_paid",
			totalFen: 301,
			trace: {
				provider: "wechat-pay",
				operation: "order-query",
				requestId: "provider-query-reconcile-003-mismatch",
			},
		});

		const result = await service.reconcileWechatPayment({
			orderId: created.orderId,
			state: "cash_paid",
			totalFen: 300,
			trace: {
				provider: "wechat-pay",
				operation: "order-query",
				requestId: "provider-query-reconcile-003-match",
			},
		});

		expect(result).toMatchObject({
			outcome: "cash_paid",
			order: { state: "cash_paid" },
		});
	});
});
