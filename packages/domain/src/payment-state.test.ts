import { expect, test } from "bun:test";
import {
	InvalidPaymentTransitionError,
	canTransitionPayment,
	transitionPayment,
} from "./payment-state";

test("payment state machine permits the verified happy path", () => {
	let state = transitionPayment("created", "authorized");
	state = transitionPayment(state, "pre_settled");
	state = transitionPayment(state, "insurance_submitted");
	state = transitionPayment(state, "insurance_settled");
	state = transitionPayment(state, "cash_pending");
	state = transitionPayment(state, "cash_paid");
	state = transitionPayment(state, "his_written_back");

	expect(transitionPayment(state, "completed")).toBe("completed");
});

test("unknown payment state cannot be treated as success", () => {
	expect(canTransitionPayment("awaiting_confirmation", "completed")).toBe(true);
	expect(() => transitionPayment("completed", "cash_pending")).toThrow(
		InvalidPaymentTransitionError,
	);
});
