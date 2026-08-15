import { config } from "@hospital/config";
import { createLogger } from "@hospital/observability";
import {
	createWorkerRuntime,
	runWorkerLoop,
	workerConfigurationMissingFields,
	workerConfigurationStatus,
	type WorkerRuntimeStatus,
} from "./runtime";

export type WorkerStatus = WorkerRuntimeStatus;

export { OutboxWorker } from "./outbox-worker";
export type { OutboxWorkerResult } from "./outbox-worker";
export {
	PaymentReconciliationWorker,
	type PaymentReconciliationWorkerResult,
} from "./payment-reconciliation-worker";
export { createWechatPaymentNotificationHandler } from "./wechat-payment-notification-handler";
export {
	createWorkerRuntime,
	runWorkerLoop,
	workerConfigurationMissingFields,
	workerConfigurationStatus,
	type WorkerRuntime,
	type WorkerRuntimeStatus,
} from "./runtime";

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
