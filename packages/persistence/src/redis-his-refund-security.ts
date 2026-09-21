/**
 * HIS 退费入口使用的 Redis 安全状态边界。
 *
 * nonce 和限流计数不能放在 API 进程内存中：正式环境重启或多实例时，
 * 进程内状态会丢失并允许重放。这里仅暴露业务需要的两个原子操作，避免
 * 把 ioredis 类型和 key 拼接规则泄漏到 API/业务层。
 */
export type HisRefundSecurityStore = {
	reserveNonce(nonce: string, expiresInSeconds: number): Promise<boolean>;
	incrementRateLimit(bucket: string, expiresInSeconds: number): Promise<number>;
};

export type RedisHisRefundSecurityClient = {
	set(
		key: string,
		value: string,
		mode: "EX",
		expiresInSeconds: number,
		condition: "NX",
	): Promise<"OK" | null | unknown>;
	incr(key: string): Promise<number>;
	expire(key: string, seconds: number): Promise<number>;
};

const NONCE_KEY_PREFIX = "hospital:his-refund:nonce:";
const RATE_KEY_PREFIX = "hospital:his-refund:rate:";

function safeBucket(value: string): string {
	return value.replace(/[^A-Za-z0-9._:-]/gu, "_").slice(0, 160);
}

export function createRedisHisRefundSecurityStore(
	client: RedisHisRefundSecurityClient,
): HisRefundSecurityStore {
	return {
		async reserveNonce(nonce, expiresInSeconds) {
			const result = await client.set(
				`${NONCE_KEY_PREFIX}${safeBucket(nonce)}`,
				"1",
				"EX",
				expiresInSeconds,
				"NX",
			);
			return result === "OK";
		},
		async incrementRateLimit(bucket, expiresInSeconds) {
			const key = `${RATE_KEY_PREFIX}${safeBucket(bucket)}`;
			const count = await client.incr(key);
			if (count === 1) await client.expire(key, expiresInSeconds);
			return count;
		},
	};
}
