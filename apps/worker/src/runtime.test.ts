import { expect, spyOn, test } from "bun:test";
import * as adapters from "@hospital/adapters";
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

test("worker requires complete Yunhealth .29/.15/.5 configuration when the gate opens", () => {
	const runtimeConfig = loadRuntimeConfig({
		PERSISTENCE_SCHEMA_READY: "true",
		DATABASE_URL: "mysql://hospital:test@127.0.0.1:3307/hospital_platform",
		YUNHEALTH_REGISTRATION_SETTLEMENT_READY: "true",
	});

	expect(workerConfigurationMissingFields(runtimeConfig)).toEqual(
		expect.arrayContaining([
			"YUNHEALTH_BASE_URL",
			"YUNHEALTH_PAYMENT_ORG_ID",
			"YUNHEALTH_PLUGIN_PAY_TYPE_ID",
			"YUNHEALTH_PLUGIN_PAY_TYPE",
		]),
	);
	expect(workerConfigurationStatus(runtimeConfig)).toBe("not_configured");
});

function completeMedicalInsuranceWorkerConfig() {
	return loadRuntimeConfig({
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
		MBS_USER_QUERY_PARTNER_SECRET: "fixture-tencent-partner-secret",
		MBS_SM2_PRIVATE_KEY_B64: "private-key",
		MBS_SM2_OWN_PUBLIC_B64: "own-public-key",
		MBS_SM2_PLATFORM_PUBLIC_B64: "platform-public-key",
		ZHONGYANG_BASE_URL: "https://zhongyang.example.test",
	});
}

test("medical insurance worker can be configured without the WeChat payment gate", () => {
	const runtimeConfig = completeMedicalInsuranceWorkerConfig();

	expect(workerConfigurationMissingFields(runtimeConfig)).toEqual([]);
	expect(workerConfigurationStatus(runtimeConfig)).toBe("ready");
});

test("medical insurance worker refuses startup without a dedicated userQuery partnerSecret", async () => {
	const runtimeConfig = {
		...completeMedicalInsuranceWorkerConfig(),
		medicalInsuranceUserQueryPartnerSecret: undefined,
	};
	const missingConfiguration = ["MBS_USER_QUERY_PARTNER_SECRET"];
	expect(workerConfigurationMissingFields(runtimeConfig)).toEqual(
		missingConfiguration,
	);
	expect(workerConfigurationStatus(runtimeConfig)).toBe("not_configured");
	const runtime = createWorkerRuntime({ runtimeConfig });
	expect(runtime.status).toBe("not_configured");
	expect(await runtime.initialize()).toEqual({
		status: "not_configured",
		missingConfiguration,
	});
	expect(await runtime.runOnce()).toEqual({
		outbox: "idle",
		reconciliation: "idle",
	});
	await runtime.close();
});

test("medical mixed reconciliation requires the ordinary WeChat APIv3 gate", () => {
	const runtimeConfig = loadRuntimeConfig({
		PERSISTENCE_SCHEMA_READY: "true",
		DATABASE_URL: "mysql://hospital:test@127.0.0.1:3307/hospital_platform",
		WECHAT_MEDICAL_INSURANCE_READY: "true",
	});

	expect(workerConfigurationMissingFields(runtimeConfig)).toContain(
		"WECHAT_PAYMENT_READY",
	);
	expect(workerConfigurationStatus(runtimeConfig)).toBe("not_configured");
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

test("worker composes HIS gateways with one settlement source while preserving provider routing", async () => {
	const runtimeConfig = {
		...completeMedicalInsuranceWorkerConfig(),
		yunhealthRegistrationSettlementReady: true,
		yunhealthBaseUrl: "https://yunhealth.example.test",
		yunhealthAuthorizationToken: "fixture-yunhealth-token",
		yunhealthPaymentOrgId: "10001",
		yunhealthRegistrationPluginPayTypeId: "5033",
		yunhealthRegistrationPluginPayType: "CREDIT",
		yunhealthRegistrationWorkStationId: "",
		yunhealthRegistrationAuthSysCode: "fixture-auth-system",
	};
	const forbiddenProviderCall = async (): Promise<never> => {
		throw new Error("Composition must not execute a provider operation");
	};
	const settlement = spyOn(
		adapters,
		"createYunhealthRegistrationSettlementGateway",
	).mockReturnValue({ writeBack: forbiddenProviderCall });
	const plugin = spyOn(
		adapters,
		"createYunhealthRegistrationPluginPaymentGateway",
	).mockReturnValue({
		createPreOrder: forbiddenProviderCall,
		completeSettlement: forbiddenProviderCall,
	});
	const medical = spyOn(
		adapters,
		"createLegacyFsiMedicalInsuranceGateway",
	).mockReturnValue({
		authorize: forbiddenProviderCall,
		uploadFees: forbiddenProviderCall,
		settle: forbiddenProviderCall,
		query: forbiddenProviderCall,
		cancel: forbiddenProviderCall,
	});
	const fetch = spyOn(globalThis, "fetch").mockImplementation(
		Object.assign(forbiddenProviderCall, { preconnect() {} }),
	);
	let runtime: ReturnType<typeof createWorkerRuntime> | undefined;
	try {
		expect(workerConfigurationMissingFields(runtimeConfig)).toEqual([]);
		runtime = createWorkerRuntime({
			runtimeConfig,
			persistence: {
				database: { check: async () => "ok" as const },
				redis: { check: async () => "not_configured" as const },
				schema: { check: async () => "unavailable" as const },
				repositories: {} as PersistenceRuntime["repositories"],
				sessions: undefined,
				async close() {},
			} as PersistenceRuntime,
		});
		expect(settlement).toHaveBeenCalledTimes(1);
		expect(plugin).toHaveBeenCalledTimes(1);
		expect(medical).toHaveBeenCalledTimes(1);
		for (const factory of [settlement, plugin]) {
			const options = factory.mock.calls[0]?.[0];
			expect(options?.settlementSource).toBe(
				adapters.DEFAULT_HIS_SETTLEMENT_SOURCE,
			);
			expect(options).toMatchObject({
				baseUrl: runtimeConfig.yunhealthBaseUrl,
				authorizationToken: runtimeConfig.yunhealthAuthorizationToken,
				authSysCode: runtimeConfig.yunhealthRegistrationAuthSysCode,
				pluginPayTypeId: "5033",
			});
		}
		expect(medical.mock.calls[0]?.[0].settlementSource).toBe(
			adapters.DEFAULT_HIS_SETTLEMENT_SOURCE,
		);
		expect(medical.mock.calls[0]?.[0]).toMatchObject({
			relayUrl: runtimeConfig.medicalInsuranceRelayUrl,
			foundationBaseUrl: runtimeConfig.medicalInsuranceFoundationBaseUrl,
			zhongyangBaseUrl: runtimeConfig.zhongyangBaseUrl,
		});
		expect(await runtime.initialize()).toMatchObject({ status: "not_ready" });
		expect(await runtime.runOnce()).toEqual({
			outbox: "idle",
			reconciliation: "idle",
		});
		expect(fetch).not.toHaveBeenCalled();
	} finally {
		await runtime?.close();
		fetch.mockRestore();
		medical.mockRestore();
		plugin.mockRestore();
		settlement.mockRestore();
	}
});
