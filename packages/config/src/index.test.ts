import { expect, test } from "bun:test";
import { loadRuntimeConfig } from "./index";

test("runtime config defaults to safe development gates", () => {
	const config = loadRuntimeConfig({});

	expect(config).toMatchObject({
		environment: "development",
		logLevel: "debug",
		persistenceSchemaReady: false,
		wechatIdentityReady: false,
		wechatPaymentReady: false,
		workerPollIntervalMs: 1000,
	});
});

test("runtime config trims secrets and parses explicit worker settings", () => {
	const config = loadRuntimeConfig({
		NODE_ENV: "production",
		LOG_LEVEL: "info",
		PERSISTENCE_SCHEMA_READY: "true",
		WORKER_POLL_INTERVAL_MS: "5000",
		DATABASE_URL: " mysql://localhost/hospital ",
		WECHAT_PAYMENT_READY: "1",
		WECHAT_PAY_API_V3_KEY: " api-v3-key ",
	});

	expect(config).toMatchObject({
		environment: "production",
		logLevel: "info",
		persistenceSchemaReady: true,
		workerPollIntervalMs: 5000,
		databaseUrl: "mysql://localhost/hospital",
		wechatPayApiV3Key: "api-v3-key",
	});
});

test("runtime config rejects an unsafe worker interval", () => {
	expect(() => loadRuntimeConfig({ WORKER_POLL_INTERVAL_MS: "10" })).toThrow(
		"WORKER_POLL_INTERVAL_MS",
	);
});
