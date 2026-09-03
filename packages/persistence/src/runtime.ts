import type { DependencyState } from "@hospital/contracts";
import type { AppLogger } from "@hospital/observability";
import Redis from "ioredis";
import { createPool, type Pool } from "mysql2/promise";
import type { DependencyPort, PersistencePorts } from "./index";
import { type CoreSchemaState, readCoreSchemaStateFromPool } from "./migrate";
import {
	createMySqlRepositories,
	type MySqlRepositories,
} from "./mysql-repositories";
import {
	createRedisSessionStore,
	type RedisSessionStore,
} from "./redis-session";
import {
	auditRedisSessionTtl,
	RedisSessionTtlAuditError,
	type RedisSessionTtlAuditResult,
} from "./redis-session-ttl-audit";

export type PersistenceRuntime = PersistencePorts & {
	/** 数据库配置存在时提供真实 repository；未配置时保持 undefined。 */
	repositories: MySqlRepositories | undefined;
	/** Redis 配置存在时提供带 TTL 的会话存储；未配置时保持 undefined。 */
	sessions: RedisSessionStore | undefined;
	/**
	 * 仅供受控维护命令使用的 TTL 聚合；正常 API 请求永远不调用 SCAN。
	 * 该方法使用独立维护凭证时才有可能通过，不能把应用 ACL 强行扩权。
	 */
	auditSessionTtl: (() => Promise<RedisSessionTtlAuditResult>) | undefined;
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
	attempts?: number;
	/** 本次只读探针从开始到结束的耗时，不代表业务请求耗时。 */
	durationMs?: number;
	schemaStatus?: string;
	missingMigrationCount?: number;
	missingSchemaObjectCount?: number;
};

/**
 * 统一计算探针耗时，避免把高精度时间戳或系统时间写入日志。
 * 运维只需要知道本次检查花了多久，且该字段始终是非负整数毫秒。
 */
function elapsedProbeMilliseconds(startedAt: number): number {
	return Math.max(0, Math.round(Date.now() - startedAt));
}

/**
 * MySQL 连接池探针只执行幂等的只读查询；第一次失败时最多再尝试一次。
 * 这个重试边界不能复用到业务 repository：业务写入的最终执行状态可能未知，
 * 不能因为网络异常而盲目重放。探针最终失败仍然返回 unavailable，保持 fail-closed。
 */
export async function probeMySqlReadOnly(
	query: () => Promise<unknown>,
	options: { attempts?: number; delayMs?: number } = {},
): Promise<number> {
	const maxAttempts = options.attempts ?? 2;
	const delayMs = options.delayMs ?? 25;
	if (!Number.isSafeInteger(maxAttempts) || maxAttempts < 1) {
		throw new Error("MySQL probe attempts must be a positive integer");
	}
	if (!Number.isFinite(delayMs) || delayMs < 0) {
		throw new Error("MySQL probe delay must be a non-negative number");
	}

	let lastError: unknown;
	for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
		try {
			await query();
			return attempt;
		} catch (error) {
			lastError = error;
			if (attempt < maxAttempts && delayMs > 0) {
				await new Promise<void>((resolve) => setTimeout(resolve, delayMs));
			}
		}
	}

	throw lastError instanceof Error
		? lastError
		: new Error("MySQL read-only probe failed");
}

function safeErrorType(error: unknown): string {
	return error instanceof Error ? error.name : "UnknownError";
}

type RedisConnectionClient = {
	readonly status: string;
	connect(): Promise<unknown>;
};

/**
 * 为同一个 Redis 客户端建立共享连接单飞。
 *
 * readiness、会话读写和维护命令可能在同一时间到达；如果每条路径都在
 * `status !== ready` 时直接调用 `connect()`，ioredis 在 `connecting` 窗口会
 * 抛出连接竞争错误，最终把基础设施仍在正常建立连接误报为 503。这里仅
 * 合并连接建立动作，不合并业务命令，也不重放任何写入；连接失败后会释放
 * Promise，下一次真实请求仍可重新建立连接。
 */
export function createRedisConnectionGate(
	client: RedisConnectionClient,
): () => Promise<void> {
	let connectionInFlight: Promise<void> | undefined;

	return async () => {
		if (client.status === "ready") return;

		if (!connectionInFlight) {
			const connection = Promise.resolve()
				.then(() => client.connect())
				.then(() => undefined)
				.finally(() => {
					if (connectionInFlight === connection) {
						connectionInFlight = undefined;
					}
				});
			connectionInFlight = connection;
		}

		await connectionInFlight;
		if (client.status !== "ready") {
			throw new Error("Redis connection did not become ready");
		}
	};
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
					...metadata,
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
			let attempts = 0;
			const startedAt = Date.now();
			try {
				attempts = await probeMySqlReadOnly(() =>
					pool.query("SELECT 1 AS health_check"),
				);
				trackProbeState("ok", {
					attempts,
					durationMs: elapsedProbeMilliseconds(startedAt),
				});
				return "ok";
			} catch (error) {
				trackProbeState("unavailable", {
					...safeErrorMetadata(error),
					operation: "mysql.health_check",
					attempts: attempts || 2,
					durationMs: elapsedProbeMilliseconds(startedAt),
				});
				return "unavailable";
			}
		},
	};
}

function createRedisPort(
	client: Redis,
	ensureRedisReady: () => Promise<void>,
	logger?: AppLogger,
): DependencyPort {
	const trackProbeState = createPersistenceProbeStateTracker(logger, "redis");

	return {
		async check(): Promise<DependencyState> {
			const startedAt = Date.now();
			try {
				await ensureRedisReady();
				await client.ping();
				trackProbeState("ok", {
					attempts: 1,
					durationMs: elapsedProbeMilliseconds(startedAt),
				});
				return "ok";
			} catch (error) {
				trackProbeState("unavailable", {
					...safeErrorMetadata(error),
					operation: "redis.health_check",
					attempts: 1,
					durationMs: elapsedProbeMilliseconds(startedAt),
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
			let attempts = 0;
			const startedAt = Date.now();
			try {
				let state: CoreSchemaState | undefined;
				attempts = await probeMySqlReadOnly(async () => {
					state = await readCoreSchemaStateFromPool(pool);
				});
				if (!state) {
					throw new Error("MySQL schema probe returned no state");
				}
				const probeState = state.status === "ready" ? "ok" : "unavailable";
				trackProbeState(probeState, {
					attempts,
					durationMs: elapsedProbeMilliseconds(startedAt),
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
					attempts: attempts || 2,
					durationMs: elapsedProbeMilliseconds(startedAt),
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
	/** 医保 6201 payToken 短期上下文的独立 AES-GCM 密钥。 */
	medicalInsuranceCredentialEncryptionKey?: string;
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
	const ensureRedisReady = redisClient
		? createRedisConnectionGate(redisClient)
		: undefined;
	const sessionClient =
		redisClient && ensureRedisReady
			? {
					async get(key: string) {
						await ensureRedisReady();
						return redisClient.get(key);
					},
					async set(
						key: string,
						value: string,
						mode: "EX",
						expiresInSeconds: number,
					) {
						await ensureRedisReady();
						return redisClient.set(key, value, mode, expiresInSeconds);
					},
				}
			: undefined;

	return {
		database: databasePool
			? createMySqlPort(databasePool, options.logger)
			: notConfiguredPort(),
		redis: redisClient
			? createRedisPort(
					redisClient,
					ensureRedisReady as () => Promise<void>,
					options.logger,
				)
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
						...(options.medicalInsuranceCredentialEncryptionKey
							? {
									medicalInsuranceCredentialEncryptionKey:
										options.medicalInsuranceCredentialEncryptionKey,
								}
							: {}),
					})
				: undefined,
		sessions: sessionClient
			? createRedisSessionStore(sessionClient)
			: undefined,
		auditSessionTtl: redisClient
			? async () => {
					try {
						await (ensureRedisReady as () => Promise<void>)();
						return await auditRedisSessionTtl(redisClient);
					} catch (error) {
						if (error instanceof RedisSessionTtlAuditError) throw error;
						// 连接失败也只暴露固定错误，不能把 URL 或 Redis 原文带到维护输出。
						throw new RedisSessionTtlAuditError(
							"redis-session-connection-unavailable",
							"Redis session TTL audit connection is unavailable",
						);
					}
				}
			: undefined,
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
