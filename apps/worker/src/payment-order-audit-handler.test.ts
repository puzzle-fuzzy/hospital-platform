import { expect, test } from "bun:test";
import type { OutboxEvent } from "@hospital/domain";
import { createLogger } from "@hospital/observability";
import {
	createPaymentOrderAuditEventHandler,
	PaymentOrderAuditEventValidationError,
} from "./payment-order-audit-handler";

const event: OutboxEvent = {
	eventId: "payment-order:order-001:created",
	eventName: "payment-order.created",
	status: "pending",
	aggregateId: "order-001",
	payload: {
		orderId: "order-001",
		patientId: "patient-001",
		amounts: { totalFen: 1000, insuranceFen: 700, cashFen: 300 },
		state: "created",
		version: 1,
	},
	occurredAt: "2026-08-31T00:00:00.000Z",
	availableAt: "2026-08-31T00:00:00.000Z",
	attempts: 0,
};

test("支付订单审计事件被显式归档且不触发外部调用", async () => {
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

	await expect(
		createPaymentOrderAuditEventHandler({ logger })(event),
	).resolves.toBeUndefined();
	const firstLine = lines[0];
	if (!firstLine) throw new Error("audit handler did not write a log record");
	const record = JSON.parse(firstLine) as Record<string, unknown>;
	expect(record).toMatchObject({
		event: "worker.outbox.audit_event_archived",
		eventName: "payment-order.created",
		aggregateId: "order-001",
	});
	expect(record).not.toHaveProperty("payload");
});

test("损坏的支付订单事件不能被当作审计事件归档", async () => {
	await expect(
		createPaymentOrderAuditEventHandler()({
			...event,
			payload: { ...event.payload, amounts: { totalFen: 1000 } },
		}),
	).rejects.toBeInstanceOf(PaymentOrderAuditEventValidationError);

	await expect(
		createPaymentOrderAuditEventHandler()({
			...event,
			eventName: "payment-order.state-changed",
			payload: { ...event.payload, orderId: "another-order" },
		}),
	).rejects.toBeInstanceOf(PaymentOrderAuditEventValidationError);
});
