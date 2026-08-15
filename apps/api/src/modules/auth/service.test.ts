import { expect, test } from "bun:test";
import { DependencyNotConfiguredError } from "@hospital/domain";
import { createRedisSessionTokenService } from "./service";

test("Redis session service issues and verifies a TTL-backed token", async () => {
	const sessions = new Map<string, string>();
	const service = createRedisSessionTokenService({
		async save(accessToken, userId) {
			sessions.set(accessToken, userId);
		},
		async findUserId(accessToken) {
			return sessions.get(accessToken);
		},
	});

	const issued = await service.issue("user-001");

	expect(issued.expiresInSeconds).toBe(3600);
	expect((await service.verify(issued.accessToken)).userId).toBe("user-001");
});

test("Redis session service fails closed when Redis is unavailable", async () => {
	const service = createRedisSessionTokenService({
		async save() {
			throw new Error("redis unavailable");
		},
		async findUserId() {
			throw new Error("redis unavailable");
		},
	});

	expect(service.issue("user-001")).rejects.toBeInstanceOf(
		DependencyNotConfiguredError,
	);
	expect(service.verify("token-001")).rejects.toBeInstanceOf(
		DependencyNotConfiguredError,
	);
});
