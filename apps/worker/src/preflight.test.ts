import { expect, test } from "bun:test";
import { loadRuntimeConfig } from "@hospital/config";
import { runWorkerPreflight } from "./preflight";

test("runtime preflight fails closed without configuration and does not need infrastructure", async () => {
	const result = await runWorkerPreflight({
		runtimeConfig: loadRuntimeConfig({}),
	});

	expect(result.passed).toBe(false);
	expect(result.checks).toContainEqual({
		name: "runtime-configuration",
		status: "failed",
		details: [
			"PERSISTENCE_SCHEMA_READY",
			"DATABASE_URL",
			"PAYMENT_DATA_ENCRYPTION_KEY",
			"WECHAT_PAYMENT_READY",
		],
	});
	expect(result.checks).toContainEqual({
		name: "persistence-schema",
		status: "skipped",
		details: ["mysql-not-ready"],
	});
});
