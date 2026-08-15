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
