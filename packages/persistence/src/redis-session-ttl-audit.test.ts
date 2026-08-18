import { expect, test } from "bun:test";
import {
	auditRedisSessionTtl,
	RedisSessionTtlAuditError,
} from "./redis-session-ttl-audit";

test("Redis 会话 TTL 审计只返回聚合结果并覆盖分页与重复 key", async () => {
	const pages = new Map<string, [string, string[]]>([
		["0", ["1", ["hospital:session:a", "hospital:session:b"]]],
		["1", ["0", ["hospital:session:b", "hospital:session:c"]]],
	]);
	const ttlByKey = new Map([
		["hospital:session:a", 120],
		["hospital:session:b", 90],
		["hospital:session:c", 300],
	]);
	const result = await auditRedisSessionTtl({
		async scan(cursor) {
			return pages.get(cursor) ?? ["0", []];
		},
		async ttl(key) {
			return ttlByKey.get(key) ?? -2;
		},
	});

	expect(result).toEqual({
		sessionCount: 3,
		ttlMin: 90,
		ttlMax: 300,
		noExpiryCount: 0,
		ttlErrorCount: 0,
		truncated: false,
		verified: true,
	});
	expect(JSON.stringify(result)).not.toContain("hospital:session:");
});

test("永久会话、扫描后消失和截断结果都不能通过 TTL 审计", async () => {
	const result = await auditRedisSessionTtl(
		{
			async scan() {
				return ["next", ["hospital:session:one", "hospital:session:two"]];
			},
			async ttl(key) {
				return key.endsWith("one") ? -1 : -2;
			},
		},
		{ maxKeys: 2 },
	);

	expect(result.verified).toBe(false);
	expect(result.truncated).toBe(true);
	expect(result.noExpiryCount).toBe(1);
	expect(result.ttlErrorCount).toBe(1);
});

test("Redis 会话 TTL 审计隐藏 SCAN 原始错误并校验有界参数", async () => {
	await expect(
		auditRedisSessionTtl({
			async scan() {
				throw new Error("NOPERM hospital:session:secret");
			},
			async ttl() {
				return 60;
			},
		}),
	).rejects.toMatchObject({
		name: "RedisSessionTtlAuditError",
		code: "redis-session-scan-unavailable",
		message: "Redis session key scan is unavailable",
	});

	await expect(
		auditRedisSessionTtl(
			{
				async scan() {
					return ["0", []];
				},
				async ttl() {
					return 60;
				},
			},
			{ maxKeys: 0 },
		),
	).rejects.toBeInstanceOf(RedisSessionTtlAuditError);
});
