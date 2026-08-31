import { expect, test } from "bun:test";
import { createRedisSessionStore } from "./redis-session";

test("redis session store scopes keys and preserves expiry", async () => {
	let storedKey = "";
	let storedValue = "";
	let storedExpiry = 0;
	const store = createRedisSessionStore({
		async set(key, value, mode, expiry) {
			storedKey = key;
			storedValue = value;
			storedExpiry = mode === "EX" ? expiry : 0;
			return "OK";
		},
		async get(key) {
			return key === storedKey ? storedValue : null;
		},
	});

	await store.save("token-001", "user-001", 3600);

	expect(storedKey).toBe("hospital:session:token-001");
	expect(storedValue).toBe("user-001");
	expect(storedExpiry).toBe(3600);
	expect(await store.findUserId("token-001")).toBe("user-001");
});

test("Redis session store 将读写传输故障投影为持久化暂不可用", async () => {
	const store = createRedisSessionStore({
		async set() {
			throw Object.assign(new Error("redis transport failure"), {
				code: "ECONNRESET",
			});
		},
		async get() {
			throw Object.assign(new Error("redis transport failure"), {
				code: "ECONNRESET",
			});
		},
	});

	await expect(store.save("token-001", "user-001", 3600)).rejects.toMatchObject(
		{
			name: "PersistenceUnavailableError",
			operation: "write",
			dependency: "redis",
			errorCode: "ECONNRESET",
		},
	);
	await expect(store.findUserId("token-001")).rejects.toMatchObject({
		name: "PersistenceUnavailableError",
		operation: "read",
		dependency: "redis",
		errorCode: "ECONNRESET",
	});
});
