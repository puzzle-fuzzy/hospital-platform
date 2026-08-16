import { createPool, type Pool } from "mysql2/promise";
import Redis from "ioredis";
import type { DependencyState } from "@hospital/contracts";
import type { AppLogger } from "@hospital/observability";
import type { DependencyPort, PersistencePorts } from "./index";
import {
	createMySqlRepositories,
	type MySqlRepositories,
} from "./mysql-repositories";
import { readCoreSchemaStateFromPool } from "./migrate";
import {
	createRedisSessionStore,
	type RedisSessionStore,
} from "./redis-session";

export type PersistenceRuntime = PersistencePorts & {
	/** 数据库配置存在时提供真实 repository；未配置时保持 undefined。 */
	repositories: MySqlRepositories | undefined;
	/** Redis 配置存在时提供带 TTL 的会话存储；未配置时保持 undefined。 */
	sessions: RedisSessionStore | undefined;
	/** 关闭数据库连接池和 Redis 客户端，供 API/Worker 的 stop 生命周期调用。 */
	close(): Promise<void>;
};

function notConfiguredPort(): DependencyPort {
	return {
		async check(): Promise<DependencyState> {
			return "not_configured";
		},
	};
}

type PersistenceProbeDependency = "database" | "redis" | "schema";

type PersistenceProbeMetadata = {
	errorType?: string;
	errorCode?: string;
	operation?: string;
	schemaStatus?: string;
	missingMigrationCount?: number;
	missingSchemaObjectCount?: number;
};

function safeErrorType(error: unknown): string {
	return error instanceof Error ? error.name : "UnknownError";
}

/**
 * 提取可用于排障的基础设施错误码；只接受固定格式的机器错误码，拒绝
 * 连接串、SQL、参数或 provider 原始消息进入日志。mysql2 常见的
 * `ECONNRESET`、`ETIMEDOUT`、`PROTOCOL_CONNECTION_LOST` 等错误码都符合该格式。
 */
export function safeErrorMetadata(
	error: unknown,
): Pick<PersistenceProbeMetadata, "errorType" | "errorCode"> {
	const errorType = safeErrorType(error);
	const rawCode =
		typeof error === "object" && error !== null
			? (error as { code?: unknown }).code
			: undefined;
	const errorCode =
		typeof rawCode === "string" && /^[A-Z][A-Z0-9_:-]{0,63}$/.test(rawCode)
			? rawCode
			: undefined;
	return {
		errorType,
		...(errorCode ? { errorCode } : {}),
	};
}

/**
 * 只在探针状态发生变化时输出日志，避免 readiness 被频繁访问时刷屏。
 *
 * 这里刻意不记录原始 error：数据库错误可能携带连接串、SQL 片段或参数，
 * 而状态变化日志的职责只是告诉运维“哪个依赖何时失效/恢复”，详细协议错误
 * 仍由请求错误日志、数据库日志和部署平台日志分别保留。
 */
export function createPersistenceProbeStateTracker(
	logger: AppLogger | undefined,
	dependency: PersistenceProbeDependency,
) {
	let previousState: DependencyState | undefined;

	return (state: DependencyState, metadata: PersistenceProbeMetadata = {}) => {
		const wasInitialState = previousState === undefined;
		const stateChanged = !wasInitialState && previousState !== state;
		const recovered = previousState === "unavailable" && state === "ok";
		previousState = state;

		if (
			!logger ||
			(!stateChanged && !(state === "unavailable" && wasInitialState))
		) {
			return;
		}

		if (state === "unavailable") {
			logger.warn(
				{
					event: "persistence.probe.unavailable",
					dependency,
					...metadata,
				},
				"Persistence dependency probe became unavailable",
			);
			return;
		}

		if (recovered) {
			logger.info(
				{
					event: "persistence.probe.recovered",
					dependency,
				},
				"Persistence dependency probe recovered",
			);
		}
	};
}

function createMySqlPort(pool: Pool, logger?: AppLogger): DependencyPort {
	const trackProbeState = createPersistenceProbeStateTracker(
		logger,
		"database",
	);

	return {
		async check(): Promise<DependencyState> {
			try {
				await pool.query("SELECT 1 AS health_check");
				trackProbeState("ok");
				return "ok";
			} catch (error) {
				trackProbeState("unavailable", {
					...safeErrorMetadata(error),
					operation: "mysql.health_check",
				});
				return "unavailable";
			}
		},
	};
}

function createRedisPort(client: Redis, logger?: AppLogger): DependencyPort {
	const trackProbeState = createPersistenceProbeStateTracker(logger, "redis");

	return {
		async check(): Promise<DependencyState> {
			try {
				if (client.status !== "ready") await client.connect();
				await client.ping();
				trackProbeState("ok");
				return "ok";
			} catch (error) {
				trackProbeState("unavailable", {
					...safeErrorMetadata(error),
					operation: "redis.health_check",
				});
				return "unavailable";
			}
		},
	};
}

/** gate 未打开时不查询 schema；gate 打开后必须由目标 migration 记录证明 ready。 */
function createSchemaPort(pool: Pool, logger?: AppLogger): DependencyPort {
	const trackProbeState = createPersistenceProbeStateTracker(logger, "schema");

	return {
		async check(): Promise<"ok" | "unavailable" | "not_configured"> {
			try {
				const state = await readCoreSchemaStateFromPool(pool);
				const probeState = state.status === "ready" ? "ok" : "unavailable";
				trackProbeState(probeState, {
					schemaStatus: state.schemaStatus,
					missingMigrationCount: state.missingMigrationIds.length,
					missingSchemaObjectCount: state.missingSchemaObjects.length,
				});
				return probeState;
			} catch (error) {
				// 表不存在、连接异常或 schema 不完整都不能进入 ready。
				trackProbeState("unavailable", {
					...safeErrorMetadata(error),
					operation: "mysql.schema_check",
				});
				return "unavailable";
			}
		},
	};
}

/**
 * 创建真实基础设施的最小运行边界。
 *
 * 这个工厂只负责连接、探针和生命周期，不负责拼装业务 repository；
 * 订单事务仓储完成前，API 仍由组合根安装 fail-closed 业务依赖。
 */
export function createPersistenceRuntime(options: {
	databaseUrl: string | undefined;
	redisUrl: string | undefined;
	/** API/worker 统一注入的 Pino logger；未传入时保持库级调用静默。 */
	logger?: AppLogger;
	/** 支付调起参数落库前的 AES-GCM 密钥；未配置时预支付 repository fail-closed。 */
	paymentDataEncryptionKey?: string;
	/** 只有显式确认目标 migration 已完成，才暴露真实 repository。 */
	useRepositories: boolean;
}): PersistenceRuntime {
	const databasePool = options.databaseUrl
		? createPool({
				uri: options.databaseUrl,
				connectionLimit: 10,
				connectTimeout: 3_000,
				dateStrings: true,
				waitForConnections: true,
			})
		: undefined;
	const redisClient = options.redisUrl
		? new Redis(options.redisUrl, {
				connectTimeout: 3_000,
				lazyConnect: true,
				maxRetriesPerRequest: 1,
				enableOfflineQueue: false,
				// 生产 ACL 只开放 PING/SELECT/GET/SET；应用自己的 ping 探针已经覆盖 ready 语义，
				// 不再让 ioredis 为 INFO 命令申请额外权限并在 journald 输出误导性 warning。
				enableReadyCheck: false,
			})
		: undefined;

	// ioredis 必须有 error listener，否则断连时 Node/Bun 可能产生未处理事件。
	redisClient?.on("error", () => undefined);

	return {
		database: databasePool
			? createMySqlPort(databasePool, options.logger)
			: notConfiguredPort(),
		redis: redisClient
			? createRedisPort(redisClient, options.logger)
			: notConfiguredPort(),
		schema:
			databasePool && options.useRepositories
				? createSchemaPort(databasePool, options.logger)
				: notConfiguredPort(),
		repositories:
			databasePool && options.useRepositories
				? createMySqlRepositories(databasePool, {
						...(options.paymentDataEncryptionKey
							? { paymentDataEncryptionKey: options.paymentDataEncryptionKey }
							: {}),
					})
				: undefined,
		sessions: redisClient ? createRedisSessionStore(redisClient) : undefined,
		async close() {
			await Promise.all([
				databasePool?.end(),
				(async () => {
					if (!redisClient || redisClient.status === "end") return;
					redisClient.disconnect();
				})(),
			]);
		},
	};
}
