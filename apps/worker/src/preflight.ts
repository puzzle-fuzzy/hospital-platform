import {
	config as defaultConfig,
	providerConfigurationDiagnostics,
	type RuntimeConfig,
} from "@hospital/config";
import {
	createLogger,
	createNoopLogger,
	type AppLogger,
} from "@hospital/observability";
import {
	createPersistenceRuntime,
	readCoreSchemaState,
} from "@hospital/persistence";

export type PreflightCheck = {
	name: string;
	status: "passed" | "failed" | "skipped";
	details?: readonly string[];
};

export type WorkerPreflightResult = {
	passed: boolean;
	checks: readonly PreflightCheck[];
};

function errorName(error: unknown): string {
	return error instanceof Error ? error.name : "UnknownError";
}

/**
 * 候选 release 的 preflight 与支付 Worker 启动是两个不同的门禁：
 * - preflight 只验证 API/只读业务所需的持久化基础设施；支付关闭是当前合法状态；
 * - Worker 启动仍由 `workerConfigurationMissingFields` 对已打开的微信支付或医保 gate
 *   分别要求各自的完整配置；两个 gate 彼此独立 fail-closed。
 *
 * 如果这里复用 Worker 的严格检查，支付尚未迁移完成时所有候选 release 都会被错误判定为
 * 不可发布；如果反过来放宽 Worker 检查，则可能启动没有密钥的支付补偿进程。两个边界必须分开。
 */
export function preflightConfigurationMissingFields(
	runtimeConfig: RuntimeConfig,
): string[] {
	const missing: string[] = [];
	if (!runtimeConfig.persistenceSchemaReady)
		missing.push("PERSISTENCE_SCHEMA_READY");
	if (!runtimeConfig.databaseUrl) missing.push("DATABASE_URL");
	if (!runtimeConfig.redisUrl) missing.push("REDIS_URL");
	if (
		runtimeConfig.wechatPaymentReady &&
		!runtimeConfig.paymentDataEncryptionKey
	) {
		missing.push("PAYMENT_DATA_ENCRYPTION_KEY");
	}
	return missing;
}

/**
 * 发布前只读验收：
 *
 * - 检查完整运行配置、MySQL/Redis 探针和目标 migration；
 * - 不执行 migration，不修改 schema gate，不调用微信或其他 provider；
 * - 日志只输出状态、缺失环境变量名和错误类型，不输出连接串或密钥。
 */
export async function runWorkerPreflight(
	options: { runtimeConfig?: RuntimeConfig; logger?: AppLogger } = {},
): Promise<WorkerPreflightResult> {
	const runtimeConfig = options.runtimeConfig ?? defaultConfig;
	const logger = options.logger ?? createNoopLogger();
	const checks: PreflightCheck[] = [];
	const missingConfiguration =
		preflightConfigurationMissingFields(runtimeConfig);

	checks.push({
		name: "runtime-configuration",
		status: missingConfiguration.length === 0 ? "passed" : "failed",
		...(missingConfiguration.length > 0
			? { details: missingConfiguration }
			: {}),
	});

	const providerDiagnostics = providerConfigurationDiagnostics(runtimeConfig);
	const incompleteProviders = providerDiagnostics.filter(
		(provider) => provider.status === "incomplete",
	);
	checks.push({
		name: "provider-configuration",
		status: incompleteProviders.length === 0 ? "passed" : "failed",
		details: providerDiagnostics.flatMap((provider) => [
			`${provider.name}:${provider.status}`,
			...provider.missingFields.map(
				(field) => `${provider.name}:missing=${field}`,
			),
		]),
	});

	const persistence = createPersistenceRuntime({
		databaseUrl: runtimeConfig.databaseUrl,
		redisUrl: runtimeConfig.redisUrl,
		useRepositories: false,
	});
	try {
		const [database, redis] = await Promise.all([
			persistence.database.check(),
			persistence.redis.check(),
		]);
		checks.push({
			name: "mysql",
			status: database === "ok" ? "passed" : "failed",
			details: [database],
		});
		checks.push({
			name: "redis",
			status: redis === "ok" ? "passed" : "failed",
			details: [redis],
		});

		if (database !== "ok" || !runtimeConfig.databaseUrl) {
			checks.push({
				name: "persistence-schema",
				status: "skipped",
				details: ["mysql-not-ready"],
			});
		} else {
			try {
				const schema = await readCoreSchemaState(runtimeConfig.databaseUrl);
				const schemaDetails = [
					`schemaStatus:${schema.schemaStatus}`,
					`expected:${schema.expectedMigrationId}`,
					...schema.missingMigrationIds.map(
						(migrationId) => `missing-migration:${migrationId}`,
					),
					...schema.missingSchemaObjects.map(
						(object) => `missing-schema:${object}`,
					),
					...(runtimeConfig.persistenceSchemaReady
						? []
						: ["PERSISTENCE_SCHEMA_READY"]),
				];
				const schemaPassed =
					schema.status === "ready" && runtimeConfig.persistenceSchemaReady;
				checks.push({
					name: "persistence-schema",
					status: schemaPassed ? "passed" : "failed",
					...(schemaDetails.length > 0 ? { details: schemaDetails } : {}),
				});
			} catch (error) {
				checks.push({
					name: "persistence-schema",
					status: "failed",
					details: [errorName(error)],
				});
			}
		}

		const passed = checks.every((check) => check.status === "passed");
		const event = passed
			? "runtime.preflight.succeeded"
			: "runtime.preflight.failed";
		logger[passed ? "info" : "error"](
			{
				event,
				checks,
				...(missingConfiguration.length > 0 ? { missingConfiguration } : {}),
			},
			passed
				? "Hospital runtime preflight passed"
				: "Hospital runtime preflight failed",
		);
		return { passed, checks };
	} finally {
		await persistence.close();
	}
}

if (import.meta.main) {
	const logger = createLogger({
		service: "hospital-runtime-preflight",
		environment: defaultConfig.environment,
		level: defaultConfig.logLevel,
	});
	const result = await runWorkerPreflight({ logger });
	if (!result.passed) process.exitCode = 1;
}
