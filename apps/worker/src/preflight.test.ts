import { expect, test } from "bun:test";
import { loadRuntimeConfig } from "@hospital/config";
import {
	preflightConfigurationMissingFields,
	runWorkerPreflight,
} from "./preflight";

test("runtime preflight fails closed without configuration and does not need infrastructure", async () => {
	const result = await runWorkerPreflight({
		runtimeConfig: loadRuntimeConfig({}),
	});

	expect(result.passed).toBe(false);
	expect(result.checks).toContainEqual({
		name: "runtime-configuration",
		status: "failed",
		details: ["PERSISTENCE_SCHEMA_READY", "DATABASE_URL", "REDIS_URL"],
	});
	expect(result.checks).toContainEqual({
		name: "persistence-schema",
		status: "skipped",
		details: ["mysql-not-ready"],
	});
	expect(result.checks).toContainEqual({
		name: "provider-configuration",
		status: "passed",
		details: [
			"wechat-identity:disabled",
			"wechat-payment:disabled",
			"zhongyang-patient-directory:disabled",
			"zhongyang-appointment-directory:disabled",
			"zhongyang-appointment-records:disabled",
			"zhongyang-outpatient-payments:disabled",
			"zhongyang-medical-records:disabled",
			"zhongyang-report-directory:disabled",
			"zhongyang-report-detail:disabled",
		],
	});
});

test("preflight allows the payment gate to remain disabled", () => {
	const runtimeConfig = loadRuntimeConfig({
		PERSISTENCE_SCHEMA_READY: "true",
		DATABASE_URL: "mysql://hospital:test@127.0.0.1:3307/hospital_platform",
		REDIS_URL: "redis://127.0.0.1:6380/3",
		WECHAT_PAYMENT_READY: "false",
	});

	expect(preflightConfigurationMissingFields(runtimeConfig)).toEqual([]);
});

test("preflight requires payment storage only after the payment gate opens", () => {
	const runtimeConfig = loadRuntimeConfig({
		PERSISTENCE_SCHEMA_READY: "true",
		DATABASE_URL: "mysql://hospital:test@127.0.0.1:3307/hospital_platform",
		REDIS_URL: "redis://127.0.0.1:6380/3",
		WECHAT_PAYMENT_READY: "true",
	});

	expect(preflightConfigurationMissingFields(runtimeConfig)).toEqual([
		"PAYMENT_DATA_ENCRYPTION_KEY",
	]);
});

test("runtime preflight fails an explicitly opened but incomplete provider gate", async () => {
	const result = await runWorkerPreflight({
		runtimeConfig: loadRuntimeConfig({
			ZHONGYANG_REPORT_DIRECTORY_READY: "true",
			ZHONGYANG_BASE_URL: "http://provider.internal",
		}),
	});

	expect(result.passed).toBe(false);
	expect(result.checks).toContainEqual({
		name: "provider-configuration",
		status: "failed",
		details: [
			"wechat-identity:disabled",
			"wechat-payment:disabled",
			"zhongyang-patient-directory:disabled",
			"zhongyang-appointment-directory:disabled",
			"zhongyang-appointment-records:disabled",
			"zhongyang-outpatient-payments:disabled",
			"zhongyang-medical-records:disabled",
			"zhongyang-report-directory:incomplete",
			"zhongyang-report-directory:missing=ZHONGYANG_BASE_URL(https)",
			"zhongyang-report-detail:disabled",
		],
	});
});
