const SESSION_KEY_PATTERN = "hospital:session:*";

/**
 * Redis 会话 TTL 审计只依赖 SCAN/TTL 两个只读命令。
 *
 * 这里不直接暴露 ioredis 类型，让维护命令和 persistence 的核心边界都能用
 * fake client 测试。线上 API 本身不需要这两个权限；维护命令应使用单独的
 * 只读 ACL，而不是给正常请求使用的账号增加 SCAN 权限。
 */
export type RedisSessionTtlAuditClient = {
	scan(
		cursor: string,
		...arguments_: readonly unknown[]
	): Promise<[cursor: string, keys: string[]]>;
	ttl(key: string): Promise<number>;
};

export type RedisSessionTtlAuditOptions = {
	/** 单次 SCAN 的 COUNT 建议值；它只是 hint，不代表返回条数上限。 */
	scanCount?: number;
	/** 维护命令的硬上限，避免异常 keyspace 让审计命令无限运行。 */
	maxKeys?: number;
};

export type RedisSessionTtlAuditResult = {
	/** 发现的会话 key 数量；key 本身永远不返回。 */
	sessionCount: number;
	/** 所有抽样会话中最短的非负 TTL，无法验证时为 null。 */
	ttlMin: number | null;
	/** 所有抽样会话中最长的非负 TTL，无法验证时为 null。 */
	ttlMax: number | null;
	/** TTL=-1 的永久 key 数量；大于 0 时审计不能通过。 */
	noExpiryCount: number;
	/** TTL 查询失败、key 在扫描后消失或返回非法值的数量。 */
	ttlErrorCount: number;
	/** 是否因 maxKeys 提前停止；截断结果不能宣称覆盖完整 keyspace。 */
	truncated: boolean;
	/** 只有非空、未截断、所有 key 都有有效 TTL 时才为 true。 */
	verified: boolean;
};

/** 审计错误只保留固定 code，不把 Redis 原始错误或 key 带到终端。 */
export class RedisSessionTtlAuditError extends Error {
	readonly code:
		| "redis-session-connection-unavailable"
		| "redis-session-scan-unavailable"
		| "redis-session-audit-options-invalid";

	constructor(code: RedisSessionTtlAuditError["code"], message: string) {
		super(message);
		this.name = "RedisSessionTtlAuditError";
		this.code = code;
	}
}

function positiveInteger(value: number | undefined, fallback: number): number {
	const resolved = value ?? fallback;
	if (!Number.isSafeInteger(resolved) || resolved < 1) {
		throw new RedisSessionTtlAuditError(
			"redis-session-audit-options-invalid",
			"Redis session TTL audit options are invalid",
		);
	}
	return resolved;
}

/**
 * 生成只读会话 TTL 聚合。
 *
 * SCAN 可能返回重复 key，也可能在并发过期时返回已经消失的 key，因此先在
 * 有界 Set 中去重，再逐个读取 TTL。`-1`（永久 key）和 `-2`（key 已消失）
 * 都不能被当作正常会话 TTL；审计宁可失败，也不能用部分结果制造“TTL 正常”的
 * 假象。任何 SCAN 异常都会转换成固定错误，原始异常不会输出。
 */
export async function auditRedisSessionTtl(
	client: RedisSessionTtlAuditClient,
	options: RedisSessionTtlAuditOptions = {},
): Promise<RedisSessionTtlAuditResult> {
	const scanCount = positiveInteger(options.scanCount, 100);
	const maxKeys = positiveInteger(options.maxKeys, 10_000);
	const keys = new Set<string>();
	let cursor = "0";
	let truncated = false;

	do {
		let page: [string, string[]];
		try {
			page = await client.scan(
				cursor,
				"MATCH",
				SESSION_KEY_PATTERN,
				"COUNT",
				scanCount,
			);
		} catch {
			throw new RedisSessionTtlAuditError(
				"redis-session-scan-unavailable",
				"Redis session key scan is unavailable",
			);
		}

		const [nextCursor, pageKeys] = page;
		if (typeof nextCursor !== "string" || !Array.isArray(pageKeys)) {
			throw new RedisSessionTtlAuditError(
				"redis-session-scan-unavailable",
				"Redis session key scan returned an invalid page",
			);
		}
		cursor = nextCursor;
		for (const key of pageKeys) {
			if (typeof key !== "string") {
				throw new RedisSessionTtlAuditError(
					"redis-session-scan-unavailable",
					"Redis session key scan returned an invalid key",
				);
			}
			keys.add(key);
			if (keys.size >= maxKeys && cursor !== "0") {
				truncated = true;
				break;
			}
		}
	} while (cursor !== "0" && !truncated);

	let ttlMin: number | null = null;
	let ttlMax: number | null = null;
	let noExpiryCount = 0;
	let ttlErrorCount = 0;
	for (const key of keys) {
		let ttl: number;
		try {
			ttl = await client.ttl(key);
		} catch {
			ttlErrorCount += 1;
			continue;
		}
		if (!Number.isSafeInteger(ttl)) {
			ttlErrorCount += 1;
			continue;
		}
		if (ttl === -1) {
			noExpiryCount += 1;
			continue;
		}
		if (ttl < 0) {
			// -2 代表扫描后 key 已消失；其它负值也不能当作有效 TTL。
			ttlErrorCount += 1;
			continue;
		}
		ttlMin = ttlMin === null ? ttl : Math.min(ttlMin, ttl);
		ttlMax = ttlMax === null ? ttl : Math.max(ttlMax, ttl);
	}

	return {
		sessionCount: keys.size,
		ttlMin,
		ttlMax,
		noExpiryCount,
		ttlErrorCount,
		truncated,
		verified:
			keys.size > 0 &&
			!truncated &&
			noExpiryCount === 0 &&
			ttlErrorCount === 0 &&
			ttlMin !== null &&
			ttlMax !== null,
	};
}
