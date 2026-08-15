import { DependencyNotConfiguredError } from "@hospital/domain";

export class PersistenceNotConfiguredError extends DependencyNotConfiguredError {
	readonly resource:
		| "identity-users"
		| "patients"
		| "payment-orders"
		| "payment-quotes";

	constructor(
		resource:
			| "identity-users"
			| "patients"
			| "payment-orders"
			| "payment-quotes",
	) {
		super(`persistence:${resource}`);
		this.name = "PersistenceNotConfiguredError";
		this.resource = resource;
	}
}
