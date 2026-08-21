import { expect, test } from "bun:test";
import { loadRuntimeConfig } from "@hospital/config";
import { createLogger } from "@hospital/observability";
import type { PersistenceRuntime } from "@hospital/persistence";
import {
	createWorkerRuntime,
	runWorkerLoop,
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
	expect(await runtime.initialize()).toEqual({
		status: "not_configured",
		missingConfiguration: [
			"PERSISTENCE_SCHEMA_READY",
			"DATABASE_URL",
			"PAYMENT_DATA_ENCRYPTION_KEY",
			"WECHAT_PAYMENT_READY",
		],
	});
	expect(await runtime.runOnce()).toEqual({
		outbox: "idle",
		reconciliation: "idle",
	});
	await runtime.close();
});

test("worker startup failure emits structured persistence readiness logs", async () => {
	const lines: string[] = [];
	const persistence = {
		database: { check: async () => "ok" as const },
		redis: { check: async () => "not_configured" as const },
		schema: { check: async () => "unavailable" as const },
		repositories: {} as PersistenceRuntime["repositories"],
		sessions: undefined,
		async close() {},
	} as PersistenceRuntime;
	const runtime = createWorkerRuntime({
		runtimeConfig: completeWorkerConfig(),
		persistence,
	});
	const logger = createLogger({
		service: "hospital-worker-test",
		environment: "test",
		level: "info",
		destination: {
			write(chunk: string) {
				lines.push(chunk);
			},
		},
	});

	await runWorkerLoop(runtime, {
		intervalMs: 1000,
		logger,
		environment: "production",
	});

	expect(JSON.parse(lines[0] ?? "{}")).toMatchObject({
		event: "service.start.failed",
		runtimeMode: "production",
		status: "not_ready",
		dependencies: { database: "ok", schema: "unavailable" },
		msg: "Hospital worker persistence is not ready; no provider work will run",
	});
});

function completeWorkerConfig() {
	return loadRuntimeConfig({
		NODE_ENV: "test",
		PERSISTENCE_SCHEMA_READY: "true",
		DATABASE_URL: "mysql://hospital:test@127.0.0.1:3307/hospital_platform",
		PAYMENT_DATA_ENCRYPTION_KEY: "test-encryption-key",
		WECHAT_PAYMENT_READY: "true",
		WECHAT_PAY_APP_ID: "wx-test-app",
		WECHAT_PAY_MCH_ID: "mch-test",
		WECHAT_PAY_MERCHANT_CERTIFICATE_SERIAL: "merchant-serial",
		WECHAT_PAY_MERCHANT_PRIVATE_KEY: "merchant-private-key",
		WECHAT_PAY_PLATFORM_CERTIFICATE_SERIAL: "platform-serial",
		WECHAT_PAY_PLATFORM_PUBLIC_KEY: "platform-public-key",
		WECHAT_PAY_API_V3_KEY: "api-v3-key",
		WECHAT_PAY_NOTIFY_URL: "https://hospital.example.test/wechat/notify",
	});
}

test("worker does not enter ready before database and schema probes pass", async () => {
	let closed = false;
	const persistence = {
		database: { check: async () => "ok" as const },
		redis: { check: async () => "not_configured" as const },
		schema: { check: async () => "unavailable" as const },
		repositories: {} as PersistenceRuntime["repositories"],
		sessions: undefined,
		async close() {
			closed = true;
		},
	} as PersistenceRuntime;
	const runtime = createWorkerRuntime({
		runtimeConfig: completeWorkerConfig(),
		persistence,
	});

	expect(runtime.status).toBe("not_ready");
	expect(await runtime.initialize()).toEqual({
		status: "not_ready",
		dependencies: { database: "ok", schema: "unavailable" },
	});
	expect(runtime.status).toBe("not_ready");
	expect(closed).toBe(true);
	expect(await runtime.runOnce()).toEqual({
		outbox: "idle",
		reconciliation: "idle",
	});
	await runtime.close();
});
