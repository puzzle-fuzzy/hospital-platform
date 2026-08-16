import { createPool, type Pool } from "mysql2/promise";
import Redis from "ioredis";
import type { DependencyState } from "@hospital/contracts";
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

function createMySqlPort(pool: Pool): DependencyPort {
	return {
		async check(): Promise<DependencyState> {
			try {
				await pool.query("SELECT 1 AS health_check");
				return "ok";
			} catch {
				// Readiness 只返回分类状态；连接错误细节由启动日志和基础设施侧采集。
				return "unavailable";
			}
		},
	};
}

function createRedisPort(client: Redis): DependencyPort {
	return {
		async check(): Promise<DependencyState> {
			try {
				if (client.status !== "ready") await client.connect();
				await client.ping();
				return "ok";
			} catch {
				// 禁止把 Redis 连接异常误报成 ready；下一次探针仍可重新连接。
				return "unavailable";
			}
		},
	};
}

/** gate 未打开时不查询 schema；gate 打开后必须由目标 migration 记录证明 ready。 */
function createSchemaPort(pool: Pool): DependencyPort {
	return {
		async check(): Promise<"ok" | "unavailable" | "not_configured"> {
			try {
				const state = await readCoreSchemaStateFromPool(pool);
				return state.status === "ready" ? "ok" : "unavailable";
			} catch {
				// 表不存在、连接异常或 schema 不完整都不能进入 ready。
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
			? createMySqlPort(databasePool)
			: notConfiguredPort(),
		redis: redisClient ? createRedisPort(redisClient) : notConfiguredPort(),
		schema:
			databasePool && options.useRepositories
				? createSchemaPort(databasePool)
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
