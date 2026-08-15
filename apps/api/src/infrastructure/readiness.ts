import type { DependencyState, ReadyPayload } from "@hospital/contracts";

export type DependencyProbe = () => Promise<DependencyState>;

export type ReadinessService = {
	snapshot(): Promise<ReadyPayload["data"]>;
};

type ReadinessOptions = {
	databaseConfigured: boolean;
	redisConfigured: boolean;
	databaseProbe?: DependencyProbe;
	redisProbe?: DependencyProbe;
};

function unconfiguredOrUnavailable(configured: boolean): DependencyState {
	return configured ? "unavailable" : "not_configured";
}

export function createReadinessService(
	options: ReadinessOptions,
): ReadinessService {
	const databaseProbe =
		options.databaseProbe ??
		(async () => unconfiguredOrUnavailable(options.databaseConfigured));
	const redisProbe =
		options.redisProbe ??
		(async () => unconfiguredOrUnavailable(options.redisConfigured));

	return {
		async snapshot() {
			const [database, redis] = await Promise.all([
				databaseProbe(),
				redisProbe(),
			]);
			const ready = database === "ok" && redis === "ok";

			return {
				status: ready ? "ready" : "not_ready",
				dependencies: { database, redis },
			};
		},
	};
}
