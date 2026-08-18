import {
	createPersistenceRuntime,
	RedisSessionTtlAuditError,
} from "@hospital/persistence";

/**
 * 受控维护命令：只输出 Redis 会话 TTL 聚合，不输出 key、凭证或患者信息。
 *
 * `REDIS_SESSION_AUDIT_URL` 应该绑定独立的只读维护 ACL；未提供时才回退到
 * 应用 `REDIS_URL`，这样在现有 ACL 禁止 SCAN 的环境中会明确失败，而不是
 * 让运维误以为应用账号具备完整 TTL 观察权限。
 */
export async function runRedisSessionTtlAudit(
	environment: Record<string, string | undefined> = Bun.env,
): Promise<number> {
	const redisUrl = environment.REDIS_SESSION_AUDIT_URL ?? environment.REDIS_URL;
	if (!redisUrl) {
		console.log(
			JSON.stringify({
				verified: false,
				error: "redis-session-not-configured",
			}),
		);
		return 2;
	}

	const persistence = createPersistenceRuntime({
		databaseUrl: undefined,
		redisUrl,
		useRepositories: false,
	});
	try {
		if (!persistence.auditSessionTtl) {
			console.log(
				JSON.stringify({
					verified: false,
					error: "redis-session-not-configured",
				}),
			);
			return 2;
		}
		const result = await persistence.auditSessionTtl();
		console.log(JSON.stringify(result));
		return result.verified ? 0 : 1;
	} catch (error) {
		const safeError =
			error instanceof RedisSessionTtlAuditError
				? error.code
				: "redis-session-audit-unavailable";
		console.log(JSON.stringify({ verified: false, error: safeError }));
		return 2;
	} finally {
		await persistence.close();
	}
}

if (import.meta.main) {
	process.exitCode = await runRedisSessionTtlAudit();
}
