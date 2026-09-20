import { isBoundedOpaqueIdentifier } from "./opaque-identifier";

export type PaymentOperatorAuditAction =
	| "payment_detail_read"
	| "refund_request"
	| "refund_query"
	| "sync_retry"
	| "manual_review";
export type PaymentOperatorAuditOutcome = "succeeded" | "failed" | "rejected";

export type PaymentOperatorAudit = {
	auditId: string;
	operatorRef: string | null;
	action: PaymentOperatorAuditAction;
	aggregateId?: string;
	requestId?: string;
	outcome: PaymentOperatorAuditOutcome;
	reasonCode?: string;
	resultDigest?: string;
	occurredAt: string;
};

export type PaymentOperatorAuditRepository = {
	append(audit: PaymentOperatorAudit): Promise<PaymentOperatorAudit>;
	listByAggregate(
		aggregateId: string,
	): Promise<readonly PaymentOperatorAudit[]>;
};

export function assertPaymentAuditIdentifier(
	value: unknown,
	label: string,
): string {
	if (!isBoundedOpaqueIdentifier(value)) throw new Error(`${label} is invalid`);
	return value;
}
