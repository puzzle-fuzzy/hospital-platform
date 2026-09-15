import { config } from "@hospital/config";
import {
	createAdminLogForwardingDestination,
	createLogger,
} from "@hospital/observability";
import {
	createWorkerRuntime,
	runWorkerLoop,
	type WorkerRuntimeStatus,
} from "./runtime";

export type WorkerStatus = WorkerRuntimeStatus;

export type {
	MedicalInsuranceQueryTask,
	MedicalInsuranceQueryTaskRepository,
	MedicalInsuranceQueryTaskStatus,
} from "@hospital/domain";
export {
	type RuntimeSmokeCheck,
	type RuntimeSmokeFetcher,
	type RuntimeSmokeOptions,
	type RuntimeSmokeResult,
	runApiRuntimeSmoke,
} from "./api-runtime-smoke";
export {
	type MedicalInsuranceOrderQueryGateway,
	MedicalInsuranceOrderReconciliationWorker,
	type MedicalInsuranceOrderReconciliationWorkerResult,
} from "./medical-insurance-order-reconciliation-worker";
export {
	MAX_MEDICAL_INSURANCE_QUERY_ATTEMPTS,
	type MedicalInsuranceQueryGateway,
	MedicalInsuranceReconciliationWorker,
	type MedicalInsuranceReconciliationWorkerResult,
} from "./medical-insurance-reconciliation-worker";
export type { OutboxWorkerResult } from "./outbox-worker";
export { OutboxWorker } from "./outbox-worker";
export {
	createPaymentOrderAuditEventHandler,
	PaymentOrderAuditEventValidationError,
} from "./payment-order-audit-handler";
export {
	PaymentReconciliationWorker,
	type PaymentReconciliationWorkerResult,
} from "./payment-reconciliation-worker";
export {
	type PreflightCheck,
	runWorkerPreflight,
	type WorkerPreflightResult,
} from "./preflight";
export {
	type ProviderSmokeCapability,
	type ProviderSmokeCheck,
	type ProviderSmokeOptions,
	type ProviderSmokeResult,
	runProviderDirectorySmoke,
} from "./provider-directory-smoke";
export {
	createWorkerRuntime,
	runWorkerLoop,
	type WorkerRuntime,
	type WorkerRuntimeStatus,
	workerConfigurationMissingFields,
	workerConfigurationStatus,
} from "./runtime";
export { createWechatPaymentNotificationHandler } from "./wechat-payment-notification-handler";

/**
 * 返回 worker 的真实启动状态，而不是只根据环境变量猜测 ready。
 *
 * 该 helper 会执行一次 MySQL/schema 只读探针并在结束后关闭连接；
 * 需要纯配置诊断时请使用 workerConfigurationStatus。
 */
export async function workerStatus(): Promise<WorkerStatus> {
	const runtime = createWorkerRuntime({ runtimeConfig: config });
	try {
		return (await runtime.initialize()).status;
	} finally {
		await runtime.close();
	}
}

if (import.meta.main) {
	const adminLogsIngestUrl = config.adminLogsIngestUrl;
	const adminLogsIngestToken = config.adminLogsIngestToken;
	const hasAdminLogsIngestUrl = Boolean(adminLogsIngestUrl);
	const hasAdminLogsIngestToken = Boolean(adminLogsIngestToken);
	if (hasAdminLogsIngestUrl !== hasAdminLogsIngestToken) {
		throw new Error(
			"ADMIN_LOGS_INGEST_URL and ADMIN_LOGS_INGEST_TOKEN must be configured together",
		);
	}
	const destination =
		adminLogsIngestUrl && adminLogsIngestToken
			? createAdminLogForwardingDestination(process.stdout, {
					url: adminLogsIngestUrl,
					token: adminLogsIngestToken,
				})
			: process.stdout;
	const logger = createLogger({
		service: "hospital-worker",
		// 与 API 共享同一份解析后的配置，避免 worker 日志与 API 日志出现模式漂移。
		environment: config.environment,
		level: (Bun.env.LOG_LEVEL as "debug" | "info" | "warn" | "error") ?? "info",
		destination,
	});
	const runtime = createWorkerRuntime({ logger });
	await runWorkerLoop(runtime, {
		intervalMs: config.workerPollIntervalMs,
		logger,
		environment: config.environment,
	});
}
