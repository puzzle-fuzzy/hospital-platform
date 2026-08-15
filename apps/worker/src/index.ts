import { createLogger } from "@hospital/observability";

export type WorkerStatus = "not_configured";

export { OutboxWorker } from "./outbox-worker";
export type { OutboxWorkerResult } from "./outbox-worker";
export {
	PaymentReconciliationWorker,
	type PaymentReconciliationWorkerResult,
} from "./payment-reconciliation-worker";

export function workerStatus(): WorkerStatus {
	return "not_configured";
}

if (import.meta.main) {
	const logger = createLogger({
		service: "hospital-worker",
		environment: Bun.env.NODE_ENV ?? "development",
		level: (Bun.env.LOG_LEVEL as "debug" | "info" | "warn" | "error") ?? "info",
	});
	logger.info(
		{ event: "service.started", status: workerStatus() },
		"Hospital worker is not configured yet",
	);
}
