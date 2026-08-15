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
import { workerConfigurationMissingFields } from "./runtime";

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
	const missingConfiguration = workerConfigurationMissingFields(runtimeConfig);

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
					`expected:${schema.expectedMigrationId}`,
					...schema.missingMigrationIds,
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
