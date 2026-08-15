import { expect, test } from "bun:test";
import {
	loadRuntimeConfig,
	patientDirectoryConfigurationMissingFields,
	patientDirectoryConfigurationStatus,
	wechatIdentityConfigurationStatus,
	wechatPaymentConfigurationMissingFields,
	wechatPaymentConfigurationStatus,
} from "./index";

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

test("provider configuration diagnostics distinguish disabled, incomplete and configured", () => {
	const disabled = loadRuntimeConfig({});
	expect(wechatIdentityConfigurationStatus(disabled)).toBe("disabled");
	expect(wechatPaymentConfigurationStatus(disabled)).toBe("disabled");
	expect(patientDirectoryConfigurationStatus(disabled)).toBe("disabled");

	const incomplete = loadRuntimeConfig({
		WECHAT_PAYMENT_READY: "true",
		WECHAT_PAY_NOTIFY_URL: "http://localhost/payment-notify",
	});
	expect(wechatPaymentConfigurationStatus(incomplete)).toBe("incomplete");
	expect(wechatPaymentConfigurationMissingFields(incomplete)).toContain(
		"WECHAT_PAY_APP_ID",
	);
	const patientDirectoryIncomplete = loadRuntimeConfig({
		ZHONGYANG_PATIENT_DIRECTORY_READY: "true",
		ZHONGYANG_PATIENT_DIRECTORY_BASE_URL: "http://zhongyang.internal",
	});
	expect(patientDirectoryConfigurationStatus(patientDirectoryIncomplete)).toBe(
		"incomplete",
	);
	expect(
		patientDirectoryConfigurationMissingFields(patientDirectoryIncomplete),
	).toContain("ZHONGYANG_PATIENT_DIRECTORY_BASE_URL(https)");
	expect(wechatPaymentConfigurationMissingFields(incomplete)).toContain(
		"WECHAT_PAY_NOTIFY_URL(https)",
	);

	const configured = loadRuntimeConfig({
		WECHAT_IDENTITY_READY: "true",
		WECHAT_APPID: "wx-test-app",
		WECHAT_APP_SECRET: "identity-secret",
		WECHAT_PAYMENT_READY: "true",
		WECHAT_PAY_APP_ID: "wx-test-app",
		WECHAT_PAY_MCH_ID: "mch-test",
		WECHAT_PAY_MERCHANT_CERTIFICATE_SERIAL: "merchant-serial",
		WECHAT_PAY_MERCHANT_PRIVATE_KEY: "merchant-private-key",
		WECHAT_PAY_PLATFORM_CERTIFICATE_SERIAL: "platform-serial",
		WECHAT_PAY_PLATFORM_PUBLIC_KEY: "platform-public-key",
		WECHAT_PAY_API_V3_KEY: "api-v3-key",
		WECHAT_PAY_NOTIFY_URL: "https://hospital.example.test/payment-notify",
	});
	expect(wechatIdentityConfigurationStatus(configured)).toBe("configured");
	expect(wechatPaymentConfigurationStatus(configured)).toBe("configured");
	const configuredPatientDirectory = loadRuntimeConfig({
		ZHONGYANG_PATIENT_DIRECTORY_READY: "true",
		ZHONGYANG_PATIENT_DIRECTORY_BASE_URL: "https://zhongyang.example.test",
		ZHONGYANG_PATIENT_DIRECTORY_AUTHORIZATION_TOKEN: "provider-token",
	});
	expect(patientDirectoryConfigurationStatus(configuredPatientDirectory)).toBe(
		"configured",
	);
});
