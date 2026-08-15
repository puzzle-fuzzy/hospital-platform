import { config } from "@hospital/config";
import { createLogger } from "@hospital/observability";
import {
	createWorkerRuntime,
	runWorkerLoop,
	type WorkerRuntimeStatus,
	workerConfigurationMissingFields,
	workerConfigurationStatus,
} from "./runtime";

export type WorkerStatus = WorkerRuntimeStatus;

export type { OutboxWorkerResult } from "./outbox-worker";
export { OutboxWorker } from "./outbox-worker";
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
	type RuntimeSmokeCheck,
	type RuntimeSmokeFetcher,
	type RuntimeSmokeOptions,
	type RuntimeSmokeResult,
	runApiRuntimeSmoke,
} from "./api-runtime-smoke";
export {
	createWorkerRuntime,
	runWorkerLoop,
	type WorkerRuntime,
	type WorkerRuntimeStatus,
	workerConfigurationMissingFields,
	workerConfigurationStatus,
} from "./runtime";
export { createWechatPaymentNotificationHandler } from "./wechat-payment-notification-handler";

export function workerStatus(): WorkerStatus {
	return workerConfigurationStatus(config);
}

if (import.meta.main) {
	const logger = createLogger({
		service: "hospital-worker",
		environment: Bun.env.NODE_ENV ?? "development",
		level: (Bun.env.LOG_LEVEL as "debug" | "info" | "warn" | "error") ?? "info",
	});
	const runtime = createWorkerRuntime({ logger });
	if (runtime.status !== "ready") {
		logger.warn(
			{
				event: "service.started",
				status: runtime.status,
				missingConfiguration: workerConfigurationMissingFields(config),
			},
			"Hospital worker is not configured; no provider work will run",
		);
	} else {
		await runWorkerLoop(runtime, {
			intervalMs: config.workerPollIntervalMs,
			logger,
		});
	}
}
