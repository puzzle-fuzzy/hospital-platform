/**
 * 新平台会话的唯一 Redis key 前缀。
 *
 * 生产部署还必须用独立 Redis DB 和 ACL key pattern 强制同一边界；
 * 这里的前缀是代码层保护，不能替代 Redis 权限。access token 只作为
 * key 的随机标识参与寻址，永远不写入日志或返回给 persistence 之外的层。
 */
const SESSION_KEY_PREFIX = "hospital:session:";

/** API 会话只依赖这两个 Redis 操作，不把 ioredis 类型泄漏到业务层。 */
export type RedisSessionClient = {
	get(key: string): Promise<string | null>;
	set(
		key: string,
		value: string,
		mode: "EX",
		expiresInSeconds: number,
	): Promise<unknown>;
};

export type RedisSessionStore = {
	save(
		accessToken: string,
		userId: string,
		expiresInSeconds: number,
	): Promise<void>;
	findUserId(accessToken: string): Promise<string | undefined>;
};

function sessionKey(accessToken: string): string {
	return `${SESSION_KEY_PREFIX}${accessToken}`;
}

/**
 * Redis session store 不记录 token 或用户身份日志；所有 key 都在本模块集中拼接，
 * 以便与生产 ACL 的 `hospital:session:*` 约束保持一致。
 */
export function createRedisSessionStore(
	client: RedisSessionClient,
): RedisSessionStore {
	return {
		async save(accessToken, userId, expiresInSeconds) {
			await client.set(sessionKey(accessToken), userId, "EX", expiresInSeconds);
		},
		async findUserId(accessToken) {
			return (await client.get(sessionKey(accessToken))) ?? undefined;
		},
	};
}
