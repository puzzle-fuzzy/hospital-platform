export type WorkerStatus = "not_configured";

export { OutboxWorker } from "./outbox-worker";
export type { OutboxWorkerResult } from "./outbox-worker";

export function workerStatus(): WorkerStatus {
	return "not_configured";
}

if (import.meta.main) {
	console.log("Hospital worker is not configured yet");
}
