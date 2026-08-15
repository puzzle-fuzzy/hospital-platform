import { expect, test } from "bun:test";
import { loadRuntimeConfig } from "@hospital/config";
import {
	createWorkerRuntime,
	workerConfigurationMissingFields,
	workerConfigurationStatus,
} from "./runtime";

test("worker runtime remains fail-closed without complete persistence/provider config", async () => {
	const runtimeConfig = loadRuntimeConfig({});

	expect(workerConfigurationStatus(runtimeConfig)).toBe("not_configured");
	expect(workerConfigurationMissingFields(runtimeConfig)).toEqual([
		"PERSISTENCE_SCHEMA_READY",
		"DATABASE_URL",
		"PAYMENT_DATA_ENCRYPTION_KEY",
		"WECHAT_PAYMENT_READY",
	]);
	const runtime = createWorkerRuntime({ runtimeConfig });
	expect(runtime.status).toBe("not_configured");
	expect(await runtime.runOnce()).toEqual({
		outbox: "idle",
		reconciliation: "idle",
	});
	await runtime.close();
});
