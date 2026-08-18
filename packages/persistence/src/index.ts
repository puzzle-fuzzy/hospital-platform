import type { DependencyState } from "@hospital/contracts";

export {
	PersistenceNotConfiguredError,
	PersistenceUnavailableError,
} from "./errors";
export { importHealthKnowledgeBundle } from "./health-knowledge-import";
export { createNotConfiguredHealthKnowledgeRepository } from "./knowledge";
export {
	type CoreSchemaState,
	PERSISTENCE_MIGRATIONS,
	readCoreSchemaState,
	readCoreSchemaStateFromPool,
	runCoreMigration,
} from "./migrate";
export { createMySqlHealthKnowledgeRepository } from "./mysql-health-knowledge-repository";
export {
	createMySqlRepositories,
	type MySqlRepositories,
} from "./mysql-repositories";
export { createInMemoryOutboxRepository } from "./outbox";
export {
	createAesGcmSecretValueCipher,
	type SecretValueCipher,
} from "./prepay-cipher";
export {
	createRedisSessionStore,
	type RedisSessionClient,
	type RedisSessionStore,
} from "./redis-session";
export {
	auditRedisSessionTtl,
	RedisSessionTtlAuditError,
	type RedisSessionTtlAuditClient,
	type RedisSessionTtlAuditOptions,
	type RedisSessionTtlAuditResult,
} from "./redis-session-ttl-audit";
export {
	createInMemoryAppointmentScheduleSnapshotRepository,
	createInMemoryIdentityUserRepository,
	createInMemoryUserProfileRepository,
	createInMemoryPatientRepository,
	createInMemoryPaymentOrderRepository,
	createInMemoryPaymentPrepayAttemptRepository,
	createInMemoryPaymentQuoteRepository,
	createInMemoryReportReferenceRepository,
	createInMemoryWechatPaymentNotificationRepository,
	createNotConfiguredRepositories,
} from "./repositories";
export { createPersistenceRuntime, type PersistenceRuntime } from "./runtime";

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
