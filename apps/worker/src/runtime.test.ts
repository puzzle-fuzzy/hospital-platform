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
		"WECHAT_PAYMENT_READY",
	]);
	const runtime = createWorkerRuntime({ runtimeConfig });
	expect(runtime.status).toBe("not_configured");
	expect(await runtime.initialize()).toEqual({
		status: "not_configured",
		missingConfiguration: [
			"PERSISTENCE_SCHEMA_READY",
			"DATABASE_URL",
			"WECHAT_PAYMENT_READY",
		],
	});
	expect(await runtime.runOnce()).toEqual({
		outbox: "idle",
		reconciliation: "idle",
	});
	await runtime.close();
});

test("medical insurance worker can be configured without the WeChat payment gate", () => {
	const runtimeConfig = loadRuntimeConfig({
		PERSISTENCE_SCHEMA_READY: "true",
		DATABASE_URL: "mysql://hospital:test@127.0.0.1:3307/hospital_platform",
		MEDICAL_INSURANCE_READY: "true",
		MEDICAL_INSURANCE_CREDENTIAL_ENCRYPTION_KEY: "medical-test-key",
		MBS_FORWARD_RELAY_URL: "https://relay.example.test",
		MBS_FORWARD_BASE_URL_6201: "http://fsi.internal",
		MBS_FORWARD_BASE_URL: "http://foundation.internal",
		MBS_FORWARD_AUTHORIZATION_TOKEN: "relay-token",
		MBS_APP_ID: "medical-app",
		MBS_APP_SECRET: "medical-secret",
		MBS_SM2_PRIVATE_KEY_B64: "private-key",
		MBS_SM2_OWN_PUBLIC_B64: "own-public-key",
		MBS_SM2_PLATFORM_PUBLIC_B64: "platform-public-key",
		ZHONGYANG_BASE_URL: "https://zhongyang.example.test",
	});

	expect(workerConfigurationMissingFields(runtimeConfig)).toEqual([]);
	expect(workerConfigurationStatus(runtimeConfig)).toBe("ready");
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
