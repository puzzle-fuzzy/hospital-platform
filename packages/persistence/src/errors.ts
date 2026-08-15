import { DependencyNotConfiguredError } from "@hospital/domain";

export class PersistenceNotConfiguredError extends DependencyNotConfiguredError {
	readonly resource:
		| "identity-users"
		| "patients"
		| "payment-orders"
		| "payment-quotes"
		| "payment-prepay-attempts";

	constructor(
		resource:
			| "identity-users"
			| "patients"
			| "payment-orders"
			| "payment-quotes"
			| "payment-prepay-attempts",
	) {
		super(`persistence:${resource}`);
		this.name = "PersistenceNotConfiguredError";
		this.resource = resource;
	}
}
