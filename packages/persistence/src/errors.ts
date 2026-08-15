import { DependencyNotConfiguredError } from "@hospital/domain";

export class PersistenceNotConfiguredError extends DependencyNotConfiguredError {
	readonly resource:
		| "identity-users"
		| "patients"
		| "payment-orders"
		| "payment-quotes"
		| "payment-prepay-attempts"
		| "wechat-payment-notifications"
		| "appointment-schedule-snapshots";

	constructor(
		resource:
			| "identity-users"
			| "patients"
			| "payment-orders"
			| "payment-quotes"
			| "payment-prepay-attempts"
			| "wechat-payment-notifications"
			| "appointment-schedule-snapshots",
	) {
		super(`persistence:${resource}`);
		this.name = "PersistenceNotConfiguredError";
		this.resource = resource;
	}
}
