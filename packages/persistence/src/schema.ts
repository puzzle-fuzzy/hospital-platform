import { createLogger } from "@hospital/observability";
import { readCoreSchemaState } from "./migrate";

const logger = createLogger({
	service: "hospital-persistence-schema",
	environment: Bun.env.NODE_ENV ?? "development",
	level: (Bun.env.LOG_LEVEL as "debug" | "info" | "warn" | "error") ?? "info",
});

/**
 * 只读 schema 验收入口。
 *
 * 它不执行 migration、不修改 PERSISTENCE_SCHEMA_READY，也不调用任何 provider；
 * 通过独立命令把“数据库结构已验证”和“运行配置/provider 已就绪”分开留证。
 */
export async function checkPersistenceSchema(): Promise<boolean> {
	try {
		const state = await readCoreSchemaState();
		const passed = state.status === "ready";
		logger[passed ? "info" : "error"](
			{
				event: "persistence.schema.checked",
				status: state.status,
				schemaStatus: state.schemaStatus,
				expectedMigrationId: state.expectedMigrationId,
				appliedMigrationIds: state.appliedMigrationIds,
				missingMigrationIds: state.missingMigrationIds,
				missingSchemaObjects: state.missingSchemaObjects,
			},
			passed
				? "Persistence schema probe passed"
				: "Persistence schema probe found incomplete target",
		);
		return passed;
	} catch (error) {
		logger.error(
			{
				event: "persistence.schema.failed",
				errorType: error instanceof Error ? error.name : "UnknownError",
			},
			"Persistence schema probe failed",
		);
		return false;
	}
}

if (import.meta.main) {
	const passed = await checkPersistenceSchema();
	if (!passed) process.exitCode = 1;
}
