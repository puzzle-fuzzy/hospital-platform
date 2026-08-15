import { expect, test } from "bun:test";
import type { OutboxEvent, WechatPaymentNotification } from "@hospital/domain";
import { createLogger } from "@hospital/observability";
import { createInMemoryWechatPaymentNotificationRepository } from "@hospital/persistence";
import {
	WechatPaymentNotificationRejectedError,
	WechatPaymentNotificationService,
} from "./notification-service";

const notification: WechatPaymentNotification = {
	notificationId: "notification-service-001",
	eventType: "TRANSACTION.SUCCESS",
	orderId: "order-service-001",
	tradeState: "SUCCESS",
	totalFen: 300,
	providerTransactionId: "4200000000000200",
	receivedAt: "2026-08-15T00:00:01.000Z",
};

test("wechat notification service records a safe event and deduplicates retries", async () => {
	const events: OutboxEvent[] = [];
	const repository = {
		record: async (value: WechatPaymentNotification, event: OutboxEvent) => {
			events.push(event);
			return {
				status:
					events.length === 1 ? ("inserted" as const) : ("duplicate" as const),
				notification: value,
			};
		},
	};
	const service = new WechatPaymentNotificationService({
		notifications: repository,
		decoder: ({ receivedAt }) => ({ ...notification, receivedAt }),
		now: () => new Date("2026-08-15T00:00:01.000Z"),
	});

	await expect(
		service.receive({
			rawBody: new TextEncoder().encode("signed-body"),
			headers: new Headers(),
		}),
	).resolves.toBe("inserted");
	await expect(
		service.receive({
			rawBody: new TextEncoder().encode("signed-body"),
			headers: new Headers(),
		}),
	).resolves.toBe("duplicate");

	expect(events).toHaveLength(2);
	expect(events[0]).toMatchObject({
		eventId: "wechat-payment-notification:notification-service-001",
		eventName: "payment.wechat-notification.received",
		aggregateId: "order-service-001",
		payload: {
			notificationId: "notification-service-001",
			orderId: "order-service-001",
			totalFen: 300,
		},
	});
	expect(JSON.stringify(events[0])).not.toContain("signed-body");
});

test("wechat notification service rejects decoder failures without exposing provider details", async () => {
	const loggerLines: string[] = [];
	const service = new WechatPaymentNotificationService({
		notifications: createInMemoryWechatPaymentNotificationRepository(),
		decoder: () => {
			throw new Error("provider signature and payer data must stay private");
		},
		logger: createLogger({
			service: "hospital-api-test",
			environment: "test",
			level: "warn",
			destination: { write: (chunk) => loggerLines.push(chunk) },
		}),
	});

	await expect(
		service.receive({ rawBody: new Uint8Array(), headers: new Headers() }),
	).rejects.toBeInstanceOf(WechatPaymentNotificationRejectedError);

	const output = loggerLines.join("\n");
	expect(output).toContain("payment.wechat_notification.rejected");
	expect(output).not.toContain("provider signature and payer data");
});

test("wechat notification repository does not store the same provider transaction twice", async () => {
	const repository = createInMemoryWechatPaymentNotificationRepository();
	const event: OutboxEvent = {
		eventId: "event-001",
		eventName: "payment.wechat-notification.received",
		aggregateId: notification.orderId,
		payload: {},
		occurredAt: notification.receivedAt,
		availableAt: notification.receivedAt,
		attempts: 0,
	};

	await expect(repository.record(notification, event)).resolves.toMatchObject({
		status: "inserted",
	});
	await expect(
		repository.record(
			{ ...notification, notificationId: "notification-service-002" },
			{ ...event, eventId: "event-002" },
		),
	).resolves.toMatchObject({
		status: "duplicate",
		notification: { notificationId: notification.notificationId },
	});
});
