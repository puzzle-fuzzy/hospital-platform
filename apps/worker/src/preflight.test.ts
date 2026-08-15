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
	expect(result.checks).toContainEqual({
		name: "provider-configuration",
		status: "passed",
		details: [
			"wechat-identity:disabled",
			"wechat-payment:disabled",
			"zhongyang-patient-directory:disabled",
			"zhongyang-appointment-directory:disabled",
			"zhongyang-appointment-records:disabled",
			"zhongyang-report-directory:disabled",
		],
	});
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
			"zhongyang-report-directory:incomplete",
			"zhongyang-report-directory:missing=ZHONGYANG_BASE_URL(https)",
		],
	});
});
