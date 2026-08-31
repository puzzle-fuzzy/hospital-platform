import type { PaymentState } from "@hospital/contracts";
import type {
	OutboxEvent,
	OutboxHandler,
	PaymentAmounts,
} from "@hospital/domain";
import {
	assertValidPaymentAmounts,
	isBoundedOpaqueIdentifier,
} from "@hospital/domain";
import { type AppLogger, createNoopLogger } from "@hospital/observability";

/** 支付订单事件当前只承担内部审计/归档职责，不触发 Provider 调用。 */
const PAYMENT_ORDER_AUDIT_EVENT_NAMES = [
	"payment-order.created",
	"payment-order.state-changed",
] as const;

const PAYMENT_STATES: readonly PaymentState[] = [
	"created",
	"authorized",
	"pre_settled",
	"insurance_submitted",
	"insurance_settled",
	"cash_pending",
	"cash_paid",
	"his_written_back",
	"awaiting_confirmation",
	"completed",
	"failed",
	"cancelled",
];

export class PaymentOrderAuditEventValidationError extends Error {
	constructor() {
		super("Payment order audit event is invalid");
		this.name = "PaymentOrderAuditEventValidationError";
	}
}

function isPaymentOrderAuditEventName(
	value: string,
): value is (typeof PAYMENT_ORDER_AUDIT_EVENT_NAMES)[number] {
	return PAYMENT_ORDER_AUDIT_EVENT_NAMES.includes(
		value as (typeof PAYMENT_ORDER_AUDIT_EVENT_NAMES)[number],
	);
}

/**
 * outbox 事件从数据库读回后仍需经过运行时校验。
 * 审计 handler 不能因为“不调用 provider”就接受任意 payload，否则损坏的
 * 订单事件会被错误标记为 processed，后续无法发现订单事实已经不完整。
 */
function assertPaymentOrderAuditEvent(event: OutboxEvent): void {
	if (
		!isPaymentOrderAuditEventName(event.eventName) ||
		!isBoundedOpaqueIdentifier(event.aggregateId) ||
		typeof event.payload !== "object" ||
		event.payload === null ||
		Array.isArray(event.payload)
	) {
		throw new PaymentOrderAuditEventValidationError();
	}
	const payload = event.payload as Record<string, unknown>;
	if (
		payload.orderId !== event.aggregateId ||
		!isBoundedOpaqueIdentifier(payload.orderId) ||
		!isBoundedOpaqueIdentifier(payload.patientId) ||
		!PAYMENT_STATES.includes(payload.state as PaymentState) ||
		!Number.isSafeInteger(payload.version) ||
		(payload.version as number) < 1
	) {
		throw new PaymentOrderAuditEventValidationError();
	}
	try {
		assertValidPaymentAmounts(payload.amounts as PaymentAmounts);
	} catch {
		throw new PaymentOrderAuditEventValidationError();
	}
}

/**
 * 归档支付订单内部事件。
 *
 * 明确注册该 handler 后，`payment-order.created` 和
 * `payment-order.state-changed` 不会因为“没有 handler”无限重试；归档成功
 * 只表示内部事件已经被消费，不代表支付、医保或 HIS 已完成。
 */
export function createPaymentOrderAuditEventHandler(
	options: { logger?: AppLogger } = {},
): OutboxHandler {
	const logger = options.logger ?? createNoopLogger();
	return async (event) => {
		assertPaymentOrderAuditEvent(event);
		logger.info(
			{
				event: "worker.outbox.audit_event_archived",
				eventId: event.eventId,
				eventName: event.eventName,
				aggregateId: event.aggregateId,
			},
			"Payment order audit event archived",
		);
	};
}
