export type WorkerStatus = "not_configured";

export function workerStatus(): WorkerStatus {
	return "not_configured";
}

if (import.meta.main) {
	console.log("Hospital worker is not configured yet");
}
