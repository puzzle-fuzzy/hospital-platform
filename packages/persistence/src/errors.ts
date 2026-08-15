import { DependencyNotConfiguredError } from "@hospital/domain";

export class PersistenceNotConfiguredError extends DependencyNotConfiguredError {
	readonly resource: "identity-users" | "patients";

	constructor(resource: "identity-users" | "patients") {
		super(`persistence:${resource}`);
		this.name = "PersistenceNotConfiguredError";
		this.resource = resource;
	}
}
