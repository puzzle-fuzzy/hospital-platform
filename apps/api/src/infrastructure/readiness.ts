import type { DependencyState, ReadyPayload } from "@hospital/contracts";

export type DependencyProbe = () => Promise<DependencyState>;

export type ReadinessService = {
	snapshot(): Promise<ReadyPayload["data"]>;
};

type ReadinessOptions = {
	databaseConfigured: boolean;
	redisConfigured: boolean;
	/** 只有完成 staging 验证后才允许业务 repository 参与就绪判定。 */
	schemaReady: boolean;
	databaseProbe?: DependencyProbe;
	redisProbe?: DependencyProbe;
	/** 生产组合根可注入真实 migration 只读探针；默认仍支持纯单元测试。 */
	schemaProbe?: DependencyProbe;
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
	const schemaProbe =
		options.schemaProbe ??
		(async (): Promise<DependencyState> =>
			options.schemaReady ? "ok" : "not_configured");

	return {
		async snapshot() {
			const [database, redis, schema] = await Promise.all([
				databaseProbe(),
				redisProbe(),
				schemaProbe(),
			]);
			const ready = database === "ok" && redis === "ok" && schema === "ok";

			return {
				status: ready ? "ready" : "not_ready",
				dependencies: { database, redis, schema },
			};
		},
	};
}
