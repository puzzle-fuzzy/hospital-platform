import type { DependencyState } from "@hospital/contracts";

export { PersistenceNotConfiguredError } from "./errors";
export {
	createInMemoryIdentityUserRepository,
	createInMemoryPatientRepository,
	createInMemoryPaymentOrderRepository,
	createInMemoryPaymentQuoteRepository,
	createNotConfiguredRepositories,
} from "./repositories";
export { createInMemoryOutboxRepository } from "./outbox";

export type DependencyPort = {
	check(): Promise<DependencyState>;
};

export type PersistencePorts = {
	database: DependencyPort;
	redis: DependencyPort;
};

export function createUnconfiguredPersistence(): PersistencePorts {
	const port: DependencyPort = {
		async check() {
			return "not_configured";
		},
	};

	return { database: port, redis: port };
}
