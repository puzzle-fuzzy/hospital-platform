import { expect, test } from "bun:test";
import { createPersistenceRuntime } from "./runtime";

test("persistence runtime stays explicit when URLs are not configured", async () => {
	const runtime = createPersistenceRuntime({
		databaseUrl: undefined,
		redisUrl: undefined,
		useRepositories: false,
	});

	expect(await runtime.database.check()).toBe("not_configured");
	expect(await runtime.redis.check()).toBe("not_configured");
	expect(await runtime.schema.check()).toBe("not_configured");
	await runtime.close();
});
