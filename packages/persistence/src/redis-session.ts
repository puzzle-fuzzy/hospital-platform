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

/** Redis session store 不记录 token 或用户身份日志；密钥前缀集中在 persistence 边界。 */
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
