import { expect, test } from "bun:test";
import {
	appointmentDirectoryConfigurationMissingFields,
	appointmentDirectoryConfigurationStatus,
	appointmentRecordsConfigurationMissingFields,
	appointmentRecordsConfigurationStatus,
	loadRuntimeConfig,
	medicalInsuranceConfigurationMissingFields,
	medicalInsuranceConfigurationStatus,
	outpatientPaymentConfigurationMissingFields,
	outpatientPaymentConfigurationStatus,
	patientBindingConfigurationMissingFields,
	patientBindingConfigurationStatus,
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
	yunhealthRegistrationSettlementConfigurationMissingFields,
	yunhealthRegistrationSettlementConfigurationStatus,
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
		medicalInsuranceReady: false,
		medicalInsuranceFoundationPath: "/mbs-fsi/web/api/fsi/callService",
		yunhealthRegistrationSettlementReady: false,
		yunhealthRegistrationPaymentSource: "1",
		yunhealthRegistrationAuthSysCode: "thirdSelfMachine",
		yunhealthRegistrationTradeTypeCode: "10",
		workerPollIntervalMs: 1000,
	});
});

test("云健康挂号自费回写必须显式配置完整的 .29/.15/.5 gate", () => {
	const incomplete = loadRuntimeConfig({
		YUNHEALTH_REGISTRATION_SETTLEMENT_READY: "true",
		YUNHEALTH_BASE_URL: "https://yunhealth.example.test",
		YUNHEALTH_AUTH_TOKEN: "server-token",
	});
	expect(yunhealthRegistrationSettlementConfigurationStatus(incomplete)).toBe(
		"incomplete",
	);
	expect(
		yunhealthRegistrationSettlementConfigurationMissingFields(incomplete),
	).toEqual(
		expect.arrayContaining([
			"YUNHEALTH_PAYMENT_ORG_ID",
			"YUNHEALTH_PLUGIN_PAY_TYPE_ID",
			"YUNHEALTH_PLUGIN_PAY_TYPE",
		]),
	);

	const configured = loadRuntimeConfig({
		YUNHEALTH_REGISTRATION_SETTLEMENT_READY: "true",
		YUNHEALTH_BASE_URL: "https://yunhealth.example.test",
		YUNHEALTH_AUTH_TOKEN: "server-token",
		YUNHEALTH_PAYMENT_ORG_ID: "10756",
		YUNHEALTH_PLUGIN_PAY_TYPE_ID: "50",
		YUNHEALTH_PLUGIN_PAY_TYPE: "CREDIT",
		YUNHEALTH_PLUGIN_WORK_STATION_ID: "",
	});
	expect(yunhealthRegistrationSettlementConfigurationStatus(configured)).toBe(
		"configured",
	);

	const legacyWithoutToken = loadRuntimeConfig({
		YUNHEALTH_REGISTRATION_SETTLEMENT_READY: "true",
		YUNHEALTH_BASE_URL: "https://yunhealth.example.test",
		YUNHEALTH_PAYMENT_ORG_ID: "10756",
		YUNHEALTH_PLUGIN_PAY_TYPE_ID: "50",
		YUNHEALTH_PLUGIN_PAY_TYPE: "CREDIT",
		YUNHEALTH_PLUGIN_WORK_STATION_ID: "",
	});
	expect(
		yunhealthRegistrationSettlementConfigurationStatus(legacyWithoutToken),
	).toBe("configured");
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
		MBS_FORWARD_PATH: " /mbs-fsi-jc/web/api/fsi/callService ",
	});

	expect(config).toMatchObject({
		environment: "production",
		logLevel: "info",
		persistenceSchemaReady: true,
		workerPollIntervalMs: 5000,
		databaseUrl: "mysql://localhost/hospital",
		wechatPayApiV3Key: "api-v3-key",
		medicalInsuranceFoundationPath: "/mbs-fsi-jc/web/api/fsi/callService",
	});
});

test("blank WeChat upstream URLs fall back to official HTTPS defaults", () => {
	const config = loadRuntimeConfig({
		WECHAT_IDENTITY_BASE_URL: "  ",
		WECHAT_PAY_BASE_URL: "",
	});

	expect(config.wechatIdentityBaseUrl).toBe("https://api.weixin.qq.com");
	expect(config.wechatPayBaseUrl).toBe("https://api.mch.weixin.qq.com");
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

test("旧服务微信配置可复用到 APIv3 医保混合支付", () => {
	const config = loadRuntimeConfig({
		WECHAT_MEDICAL_INSURANCE_READY: "true",
		WECHAT_APPID: "wx-legacy-app",
		WECHAT_APPSECRET: "legacy-app-secret",
		WECHAT_MCH_ID: "legacy-mch-id",
		WECHAT_MED_INS_CITY_ID: "140500",
		WECHAT_MED_INS_CHANNEL_NO: "legacy-channel",
		WECHAT_MEDICAL_INSURANCE_CALLBACK_URL:
			"https://new.example.test/api/v1/payments/medical-insurance/wechat-notifications",
	});

	expect(config).toMatchObject({
		wechatAppId: "wx-legacy-app",
		wechatAppSecret: "legacy-app-secret",
		wechatPayAppId: "wx-legacy-app",
		wechatPayMchId: "legacy-mch-id",
		wechatMedicalInsuranceAppId: "wx-legacy-app",
		wechatMedicalInsuranceCityId: "140500",
		wechatMedicalInsuranceInstitutionName: "高平市人民医院",
		wechatMedicalInsuranceInstitutionNo: "H14058101270",
		wechatMedicalInsuranceChannelNo: "legacy-channel",
		wechatMedicalInsuranceCallbackUrl:
			"https://new.example.test/api/v1/payments/medical-insurance/wechat-notifications",
	});
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
	expect(medicalInsuranceConfigurationStatus(disabled)).toBe("disabled");

	const incomplete = loadRuntimeConfig({
		WECHAT_PAYMENT_READY: "true",
		WECHAT_PAY_NOTIFY_URL: "http://localhost/payment-notify",
	});
	expect(wechatPaymentConfigurationStatus(incomplete)).toBe("incomplete");
	expect(wechatPaymentConfigurationMissingFields(incomplete)).toContain(
		"WECHAT_PAY_APP_ID",
	);
	const medicalInsuranceIncomplete = loadRuntimeConfig({
		MEDICAL_INSURANCE_READY: "true",
		MBS_FORWARD_RELAY_URL: "http://medical-insurance.internal/forward",
		MBS_FORWARD_BASE_URL_6201: "http://medical-insurance.internal",
		MBS_ENCRYPT_ENABLE: "false",
		MBS_SM2_VERIFY_STRICT: "false",
	});
	expect(medicalInsuranceConfigurationStatus(medicalInsuranceIncomplete)).toBe(
		"incomplete",
	);
	expect(
		medicalInsuranceConfigurationMissingFields(medicalInsuranceIncomplete),
	).toEqual(
		expect.arrayContaining([
			"MBS_FORWARD_AUTHORIZATION_TOKEN",
			"MBS_SM2_PRIVATE_KEY_B64",
			"MBS_FORWARD_RELAY_URL(https)",
			"MBS_ENCRYPT_ENABLE",
		]),
	);
	const nonStrict = loadRuntimeConfig({
		MBS_SM2_VERIFY_STRICT: "false",
	});
	expect(nonStrict.medicalInsuranceVerifyStrict).toBeFalse();
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
	const patientBindingWithoutDirectory = loadRuntimeConfig({
		ZHONGYANG_PATIENT_BINDING_READY: "true",
		ZHONGYANG_BASE_URL: "https://zhongyang.example.test",
	});
	expect(
		patientBindingConfigurationStatus(patientBindingWithoutDirectory),
	).toBe("incomplete");
	expect(
		patientBindingConfigurationMissingFields(patientBindingWithoutDirectory),
	).toContain("ZHONGYANG_PATIENT_DIRECTORY_READY");
	expect(
		patientBindingConfigurationMissingFields(patientBindingWithoutDirectory),
	).toEqual(
		expect.arrayContaining([
			"ZHONGYANG_PATIENT_ORG_ID",
			"ZHONGYANG_PATIENT_HOSPITAL_ID",
			"ZHONGYANG_PATIENT_CARD_TYPE_ID",
		]),
	);
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
	expect(
		outpatientPaymentConfigurationMissingFields(outpatientPaymentIncomplete),
	).toContain("OUTPATIENT_PAYMENT_AUTH_SYS_CODE");
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
		ZHONGYANG_PATIENT_BINDING_READY: "true",
		ZHONGYANG_PATIENT_ORG_ID: "10756",
		ZHONGYANG_PATIENT_HOSPITAL_ID: "10389001",
		ZHONGYANG_PATIENT_CARD_TYPE_ID: "3",
		ZHONGYANG_APPOINTMENT_DIRECTORY_READY: "true",
		ZHONGYANG_APPOINTMENT_RECORDS_READY: "true",
		ZHONGYANG_OUTPATIENT_PAYMENT_READY: "true",
		OUTPATIENT_PAYMENT_AUTH_SYS_CODE: "thirdSelfMachine",
		ZHONGYANG_REPORT_DIRECTORY_READY: "true",
		ZHONGYANG_REPORT_DETAIL_READY: "true",
		ZHONGYANG_BASE_URL: "https://zhongyang.example.test",
		ZHONGYANG_AUTHORIZATION_TOKEN: "provider-token",
	});
	expect(patientDirectoryConfigurationStatus(configuredPatientDirectory)).toBe(
		"configured",
	);
	expect(patientBindingConfigurationStatus(configuredPatientDirectory)).toBe(
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
