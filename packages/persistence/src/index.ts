import type { DependencyState } from "@hospital/contracts";

export { PersistenceNotConfiguredError } from "./errors";
export {
	createInMemoryAppointmentScheduleSnapshotRepository,
	createInMemoryIdentityUserRepository,
	createInMemoryPatientRepository,
	createInMemoryPaymentOrderRepository,
	createInMemoryPaymentPrepayAttemptRepository,
	createInMemoryPaymentQuoteRepository,
	createInMemoryReportReferenceRepository,
	createInMemoryWechatPaymentNotificationRepository,
	createNotConfiguredRepositories,
} from "./repositories";
export { createInMemoryOutboxRepository } from "./outbox";
export {
	createAesGcmSecretValueCipher,
	type SecretValueCipher,
} from "./prepay-cipher";
export { createPersistenceRuntime, type PersistenceRuntime } from "./runtime";
export {
	PERSISTENCE_MIGRATIONS,
	readCoreSchemaState,
	readCoreSchemaStateFromPool,
	runCoreMigration,
	type CoreSchemaState,
} from "./migrate";
export {
	createMySqlRepositories,
	type MySqlRepositories,
} from "./mysql-repositories";
export {
	createRedisSessionStore,
	type RedisSessionClient,
	type RedisSessionStore,
} from "./redis-session";

export type DependencyPort = {
	check(): Promise<DependencyState>;
};

export type PersistencePorts = {
	database: DependencyPort;
	redis: DependencyPort;
	/** 真实 migration 状态；不会因为 gate 打开而跳过只读核对。 */
	schema: DependencyPort;
};

export function createUnconfiguredPersistence(): PersistencePorts {
	const port: DependencyPort = {
		async check() {
			return "not_configured";
		},
	};

	return { database: port, redis: port, schema: port };
}
