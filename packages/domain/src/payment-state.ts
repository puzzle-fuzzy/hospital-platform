import type { PaymentState } from "@hospital/contracts";

/**
 * 支付状态只允许沿显式边迁移；未知 provider 结果必须先进入待确认，
 * 不能因为页面或单次请求失败就直接推导 completed/failed。
 */
const transitions: Record<PaymentState, readonly PaymentState[]> = {
	created: ["authorized", "cancelled"],
	authorized: ["pre_settled", "cancelled"],
	pre_settled: ["insurance_submitted", "cash_pending", "cancelled"],
	insurance_submitted: ["insurance_settled", "awaiting_confirmation", "failed"],
	insurance_settled: ["cash_pending", "his_written_back", "failed"],
	cash_pending: ["cash_paid", "awaiting_confirmation", "failed"],
	cash_paid: ["his_written_back", "failed"],
	his_written_back: ["completed", "awaiting_confirmation", "failed"],
	awaiting_confirmation: [
		"insurance_settled",
		"cash_pending",
		"cash_paid",
		"his_written_back",
		"completed",
		"failed",
		"cancelled",
	],
	completed: [],
	failed: [],
	cancelled: [],
};

export class InvalidPaymentTransitionError extends Error {
	readonly from: PaymentState;
	readonly to: PaymentState;

	constructor(from: PaymentState, to: PaymentState) {
		super(`Invalid payment transition: ${from} -> ${to}`);
		this.name = "InvalidPaymentTransitionError";
		this.from = from;
		this.to = to;
	}
}

export function canTransitionPayment(
	from: PaymentState,
	to: PaymentState,
): boolean {
	return transitions[from].includes(to);
}

export function transitionPayment(
	from: PaymentState,
	to: PaymentState,
): PaymentState {
	if (!canTransitionPayment(from, to)) {
		throw new InvalidPaymentTransitionError(from, to);
	}

	return to;
}

export function allowedPaymentTransitions(
	from: PaymentState,
): readonly PaymentState[] {
	return transitions[from];
}
