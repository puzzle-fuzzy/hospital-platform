import { expect, test } from "bun:test";
import type {
	OutboxEvent,
	PaymentOrder,
	PaymentOrderRepository,
} from "@hospital/domain";
import {
	PaymentOrderService,
	createWechatPaymentNotificationEvent,
} from "@hospital/domain";
import { createLogger } from "@hospital/observability";
import { createWechatPaymentNotificationHandler } from "./wechat-payment-notification-handler";

const amounts = {
	totalFen: 1000,
	insuranceFen: 700,
	cashFen: 300,
};

function createMemoryOrders(): {
	repository: PaymentOrderRepository;
	read(orderId: string): PaymentOrder | undefined;
} {
	const orders = new Map<string, PaymentOrder>();
	return {
		repository: {
			async findById(orderId) {
				return orders.get(orderId);
			},
			async findByOwnerAndIdempotencyKey() {
				return undefined;
			},
			async findByOwnerAndId(ownerUserId, orderId) {
				const order = orders.get(orderId);
				return order?.ownerUserId === ownerUserId ? order : undefined;
			},
			async insert(order) {
				orders.set(order.orderId, order);
				return order;
			},
			async update(order, expectedVersion) {
				const current = orders.get(order.orderId);
				if (!current || current.version !== expectedVersion) {
					throw new Error("Payment order version conflict");
				}
				orders.set(order.orderId, order);
				return order;
			},
		},
		read(orderId) {
			return orders.get(orderId);
		},
	};
}

async function createCashPendingOrder(
	repository: PaymentOrderRepository,
): Promise<PaymentOrder> {
	const service = new PaymentOrderService({
		orders: repository,
		createOrderId: () => "order-notification-001",
	});
	const order = await service.create({
		ownerUserId: "user-notification-001",
		patientId: "patient-notification-001",
		idempotencyKey: "pay-notification-001",
		amounts,
	});
	for (const state of [
		"authorized",
		"pre_settled",
		"insurance_submitted",
		"insurance_settled",
		"cash_pending",
	] as const) {
		await service.transition(order.ownerUserId, order.orderId, state);
	}
	return order;
}

function createNotificationEvent(
	patch: Partial<
		Parameters<typeof createWechatPaymentNotificationEvent>[0]
	> = {},
): OutboxEvent {
	return createWechatPaymentNotificationEvent({
		notificationId: "notification-001",
		eventType: "TRANSACTION.SUCCESS",
		orderId: "order-notification-001",
		tradeState: "SUCCESS",
		totalFen: 300,
		providerTransactionId: "4200000000000001",
		receivedAt: "2026-08-15T00:00:00.000Z",
		...patch,
	});
}

test("notification handler applies a safe matching fact to the order", async () => {
	const memory = createMemoryOrders();
	await createCashPendingOrder(memory.repository);
	const service = new PaymentOrderService({ orders: memory.repository });
	const handler = createWechatPaymentNotificationHandler({ orders: service });

	await handler(createNotificationEvent());

	expect(memory.read("order-notification-001")).toMatchObject({
		state: "cash_paid",
		version: 7,
	});
});

test("notification handler never treats a mismatched amount as paid", async () => {
	const memory = createMemoryOrders();
	await createCashPendingOrder(memory.repository);
	const service = new PaymentOrderService({ orders: memory.repository });
	const handler = createWechatPaymentNotificationHandler({ orders: service });

	await handler(createNotificationEvent({ totalFen: 301 }));

	expect(memory.read("order-notification-001")).toMatchObject({
		state: "awaiting_confirmation",
	});
});

test("notification handler rejects malformed internal event payload", async () => {
	const memory = createMemoryOrders();
	await createCashPendingOrder(memory.repository);
	const service = new PaymentOrderService({ orders: memory.repository });
	const handler = createWechatPaymentNotificationHandler({ orders: service });
	const event = createNotificationEvent();

	await expect(
		handler({
			...event,
			payload: { ...event.payload, rawResource: "must-not-be-consumed" },
		} as OutboxEvent),
	).resolves.toBeUndefined();
	// Extra fields are ignored; the handler only maps the known safe fields.
	await expect(
		handler({
			...event,
			payload: { ...event.payload, totalFen: "300" },
		} as OutboxEvent),
	).rejects.toThrow("Invalid WeChat notification amount");
});

test("notification handler emits searchable reconciliation metadata", async () => {
	const memory = createMemoryOrders();
	await createCashPendingOrder(memory.repository);
	const lines: string[] = [];
	const logger = createLogger({
		service: "hospital-worker-test",
		environment: "test",
		level: "info",
		destination: {
			write(chunk: string) {
				lines.push(chunk);
			},
		},
	});
	const handler = createWechatPaymentNotificationHandler({
		orders: new PaymentOrderService({ orders: memory.repository }),
		logger,
	});

	await handler(createNotificationEvent());

	const record = JSON.parse(lines[0] ?? "{}") as Record<string, unknown>;
	expect(record).toMatchObject({
		event: "worker.payment.wechat_notification.reconciled",
		notificationId: "notification-001",
		providerTransactionId: "4200000000000001",
		orderState: "cash_paid",
	});
});
