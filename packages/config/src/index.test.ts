import { expect, test } from "bun:test";
import {
	appointmentDirectoryConfigurationMissingFields,
	appointmentDirectoryConfigurationStatus,
	appointmentRecordsConfigurationMissingFields,
	appointmentRecordsConfigurationStatus,
	loadRuntimeConfig,
	outpatientPaymentConfigurationMissingFields,
	outpatientPaymentConfigurationStatus,
	patientDirectoryConfigurationMissingFields,
	patientDirectoryConfigurationStatus,
	reportDetailConfigurationMissingFields,
	reportDetailConfigurationStatus,
	reportDirectoryConfigurationMissingFields,
	reportDirectoryConfigurationStatus,
	wechatIdentityConfigurationMissingFields,
	wechatIdentityConfigurationStatus,
	wechatPaymentConfigurationMissingFields,
	wechatPaymentConfigurationStatus,
} from "./index";

test("runtime config defaults to safe development gates", () => {
	const config = loadRuntimeConfig({});

	expect(config).toMatchObject({
		environment: "development",
		host: "127.0.0.1",
		logLevel: "debug",
		persistenceSchemaReady: false,
		wechatIdentityReady: false,
		wechatPaymentReady: false,
		workerPollIntervalMs: 1000,
	});
});

test("production runtime listens on container interfaces by default", () => {
	const production = loadRuntimeConfig({ NODE_ENV: "production" });
	const explicit = loadRuntimeConfig({
		NODE_ENV: "production",
		HOST: "10.0.0.8",
	});

	expect(production.host).toBe("0.0.0.0");
	expect(explicit.host).toBe("10.0.0.8");
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

test("runtime config reads legacy Zhongyang variable names during migration", () => {
	const config = loadRuntimeConfig({
		ZHONGYANG_PATIENT_DIRECTORY_BASE_URL: "https://legacy.example.test",
		ZHONGYANG_PATIENT_DIRECTORY_AUTHORIZATION_TOKEN: "legacy-token",
	});

	expect(config.zhongyangBaseUrl).toBe("https://legacy.example.test");
	expect(config.zhongyangAuthorizationToken).toBe("legacy-token");
});

test("provider base URL overrides must remain HTTPS when a gate is open", () => {
	const runtimeConfig = loadRuntimeConfig({
		WECHAT_IDENTITY_READY: "true",
		WECHAT_APPID: "wx-test-app",
		WECHAT_APP_SECRET: "identity-secret",
		WECHAT_IDENTITY_BASE_URL: "http://wechat.internal",
		WECHAT_PAYMENT_READY: "true",
		WECHAT_PAY_APP_ID: "wx-test-app",
		WECHAT_PAY_MCH_ID: "mch-test",
		WECHAT_PAY_MERCHANT_CERTIFICATE_SERIAL: "merchant-serial",
		WECHAT_PAY_MERCHANT_PRIVATE_KEY: "merchant-private-key",
		WECHAT_PAY_PLATFORM_CERTIFICATE_SERIAL: "platform-serial",
		WECHAT_PAY_PLATFORM_PUBLIC_KEY: "platform-public-key",
		WECHAT_PAY_API_V3_KEY: "api-v3-key",
		WECHAT_PAY_NOTIFY_URL: "https://hospital.example.test/payment-notify",
		WECHAT_PAY_BASE_URL: "http://wechat-pay.internal",
	});

	expect(wechatIdentityConfigurationStatus(runtimeConfig)).toBe("incomplete");
	expect(wechatPaymentConfigurationStatus(runtimeConfig)).toBe("incomplete");
	expect(wechatIdentityConfigurationMissingFields(runtimeConfig)).toContain(
		"WECHAT_IDENTITY_BASE_URL(https)",
	);
	expect(wechatPaymentConfigurationMissingFields(runtimeConfig)).toContain(
		"WECHAT_PAY_BASE_URL(https)",
	);
});

test("provider configuration diagnostics distinguish disabled, incomplete and configured", () => {
	const disabled = loadRuntimeConfig({});
	expect(wechatIdentityConfigurationStatus(disabled)).toBe("disabled");
	expect(wechatPaymentConfigurationStatus(disabled)).toBe("disabled");
	expect(patientDirectoryConfigurationStatus(disabled)).toBe("disabled");
	expect(appointmentDirectoryConfigurationStatus(disabled)).toBe("disabled");
	expect(appointmentRecordsConfigurationStatus(disabled)).toBe("disabled");
	expect(outpatientPaymentConfigurationStatus(disabled)).toBe("disabled");
	expect(reportDirectoryConfigurationStatus(disabled)).toBe("disabled");
	expect(reportDetailConfigurationStatus(disabled)).toBe("disabled");

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
		ZHONGYANG_BASE_URL: "http://zhongyang.internal",
	});
	expect(patientDirectoryConfigurationStatus(patientDirectoryIncomplete)).toBe(
		"incomplete",
	);
	expect(
		patientDirectoryConfigurationMissingFields(patientDirectoryIncomplete),
	).toContain("ZHONGYANG_BASE_URL(https)");
	const appointmentDirectoryIncomplete = loadRuntimeConfig({
		ZHONGYANG_APPOINTMENT_DIRECTORY_READY: "true",
		ZHONGYANG_BASE_URL: "http://zhongyang.internal",
	});
	expect(
		appointmentDirectoryConfigurationStatus(appointmentDirectoryIncomplete),
	).toBe("incomplete");
	expect(
		appointmentDirectoryConfigurationMissingFields(
			appointmentDirectoryIncomplete,
		),
	).toContain("ZHONGYANG_BASE_URL(https)");
	const reportDirectoryIncomplete = loadRuntimeConfig({
		ZHONGYANG_REPORT_DIRECTORY_READY: "true",
		ZHONGYANG_BASE_URL: "http://zhongyang.internal",
	});
	const reportDetailIncomplete = loadRuntimeConfig({
		ZHONGYANG_REPORT_DETAIL_READY: "true",
		ZHONGYANG_BASE_URL: "http://zhongyang.internal",
	});
	const appointmentRecordsIncomplete = loadRuntimeConfig({
		ZHONGYANG_APPOINTMENT_RECORDS_READY: "true",
		ZHONGYANG_BASE_URL: "http://zhongyang.internal",
	});
	const outpatientPaymentIncomplete = loadRuntimeConfig({
		ZHONGYANG_OUTPATIENT_PAYMENT_READY: "true",
		ZHONGYANG_BASE_URL: "http://zhongyang.internal",
	});
	expect(
		appointmentRecordsConfigurationStatus(appointmentRecordsIncomplete),
	).toBe("incomplete");
	expect(
		appointmentRecordsConfigurationMissingFields(appointmentRecordsIncomplete),
	).toContain("ZHONGYANG_BASE_URL(https)");
	expect(
		outpatientPaymentConfigurationStatus(outpatientPaymentIncomplete),
	).toBe("incomplete");
	expect(
		outpatientPaymentConfigurationMissingFields(outpatientPaymentIncomplete),
	).toContain("ZHONGYANG_BASE_URL(https)");
	expect(reportDirectoryConfigurationStatus(reportDirectoryIncomplete)).toBe(
		"incomplete",
	);
	expect(reportDetailConfigurationStatus(reportDetailIncomplete)).toBe(
		"incomplete",
	);
	expect(
		reportDirectoryConfigurationMissingFields(reportDirectoryIncomplete),
	).toContain("ZHONGYANG_BASE_URL(https)");
	expect(
		reportDetailConfigurationMissingFields(reportDetailIncomplete),
	).toContain("ZHONGYANG_BASE_URL(https)");
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
		ZHONGYANG_APPOINTMENT_DIRECTORY_READY: "true",
		ZHONGYANG_APPOINTMENT_RECORDS_READY: "true",
		ZHONGYANG_OUTPATIENT_PAYMENT_READY: "true",
		ZHONGYANG_REPORT_DIRECTORY_READY: "true",
		ZHONGYANG_REPORT_DETAIL_READY: "true",
		ZHONGYANG_BASE_URL: "https://zhongyang.example.test",
		ZHONGYANG_AUTHORIZATION_TOKEN: "provider-token",
	});
	expect(patientDirectoryConfigurationStatus(configuredPatientDirectory)).toBe(
		"configured",
	);
	expect(
		appointmentDirectoryConfigurationStatus(configuredPatientDirectory),
	).toBe("configured");
	expect(
		appointmentRecordsConfigurationStatus(configuredPatientDirectory),
	).toBe("configured");
	expect(outpatientPaymentConfigurationStatus(configuredPatientDirectory)).toBe(
		"configured",
	);
	expect(reportDirectoryConfigurationStatus(configuredPatientDirectory)).toBe(
		"configured",
	);
	expect(reportDetailConfigurationStatus(configuredPatientDirectory)).toBe(
		"configured",
	);
});
