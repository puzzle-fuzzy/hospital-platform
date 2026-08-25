import { isAbsolute, resolve } from "node:path";
import {
	HealthKnowledgeImportValidationError,
	validateHealthKnowledgeImportBundle,
} from "@hospital/domain";
import { createLogger } from "@hospital/observability";
import { createPool, type Pool } from "mysql2/promise";
import { importHealthKnowledgeBundle } from "../src/health-knowledge-import.ts";

const USAGE =
	"用法：pnpm --filter @hospital/persistence health:import-staging -- --confirm-staging <脱敏健康知识 bundle.json>";

type HealthKnowledgeImportArguments = {
	inputPath: string | undefined;
	confirmed: boolean;
	extraArguments: string[];
	showHelp: boolean;
};

/**
 * staging 导入命令只允许一个文件和一个显式确认开关。
 *
 * 这里不接受任意 `--env` 或数据库 URL 参数，避免操作者在命令行临时
 * 指向一套未经过部署门禁的数据库。目标环境必须由受控环境变量提供，
 * 文件内容仍会在拿到数据库连接前经过 domain 的完整校验。
 */
export function parseHealthKnowledgeImportArguments(
	args: readonly string[],
): HealthKnowledgeImportArguments {
	const normalizedArgs = args[0] === "--" ? args.slice(1) : args;
	if (normalizedArgs.length === 1 && normalizedArgs[0] === "--help") {
		return {
			inputPath: undefined,
			confirmed: false,
			extraArguments: [],
			showHelp: true,
		};
	}

	const confirmed = normalizedArgs.includes("--confirm-staging");
	const positionalArguments = normalizedArgs.filter(
		(argument) => argument !== "--confirm-staging",
	);
	return {
		inputPath: positionalArguments[0],
		confirmed,
		extraArguments: positionalArguments.slice(1),
		showHelp: false,
	};
}

function resolveInputPath(inputPath: string): string {
	if (isAbsolute(inputPath)) return inputPath;
	const invocationDirectory = process.env.INIT_CWD?.trim() || process.cwd();
	return resolve(invocationDirectory, inputPath);
}

/**
 * 这是“只允许 staging”的最后一道环境门禁。
 *
 * bundle 中的 `published` 代表内容审核状态，不代表数据库就是安全的
 * staging；两者不能互相替代。生产环境即使操作者带了确认参数，也必须
 * 在这里被拒绝，避免把内容导入工具变成绕过发布流程的隐式生产写入口。
 */
function requireStagingDatabaseUrl(): string {
	const targetEnvironment = (
		process.env.DEPLOY_ENV ??
		process.env.APP_ENV ??
		process.env.NODE_ENV ??
		""
	)
		.trim()
		.toLowerCase();
	if (targetEnvironment !== "staging") {
		throw new Error("health knowledge import requires DEPLOY_ENV=staging");
	}
	const databaseUrl = process.env.DATABASE_URL?.trim();
	if (!databaseUrl) throw new Error("DATABASE_URL is required");
	return databaseUrl;
}

function createImportLogger() {
	return createLogger({
		service: "hospital-persistence-health-knowledge-import",
		environment: "staging",
		level:
			(process.env.LOG_LEVEL as "debug" | "info" | "warn" | "error") ?? "info",
	});
}

function safeErrorType(error: unknown): string {
	return error instanceof Error ? error.name : "UnknownError";
}

/**
 * 受控 staging 导入入口：先读文件和校验 bundle，再建立 MySQL 连接。
 *
 * 导入函数自身还会再次校验并在一个事务内写入；这里的前置校验是为了
 * 让格式错误在连接数据库之前失败，而事务校验是为了防止未来其它调用
 * 方绕过 CLI 时失去同一条 domain 边界。日志只记录事件、版本和数量，
 * 不记录正文、患者字段、连接串、SQL 或原始异常消息。
 */
export async function runHealthKnowledgeStagingImport(
	args: readonly string[] = process.argv.slice(2),
): Promise<boolean> {
	const logger = createImportLogger();
	const parsed = parseHealthKnowledgeImportArguments(args);
	if (
		parsed.showHelp ||
		!parsed.inputPath ||
		!parsed.confirmed ||
		parsed.extraArguments.length > 0
	) {
		console.error(USAGE);
		return parsed.showHelp;
	}

	let pool: Pool | undefined;
	try {
		const input = await Bun.file(resolveInputPath(parsed.inputPath)).json();
		const validatedSummary = validateHealthKnowledgeImportBundle(input);
		const databaseUrl = requireStagingDatabaseUrl();
		pool = createPool({
			uri: databaseUrl,
			connectionLimit: 4,
			connectTimeout: 3_000,
			dateStrings: true,
			waitForConnections: true,
		});

		logger.info(
			{
				event: "health-knowledge.import.started",
				contentVersion: validatedSummary.contentVersion,
				status: validatedSummary.status,
			},
			"Health knowledge staging import started",
		);
		const summary = await importHealthKnowledgeBundle(pool, input);
		logger.info(
			{
				event: "health-knowledge.import.completed",
				contentVersion: summary.contentVersion,
				status: summary.status,
				itemCount: summary.itemCount,
				diseaseCount: summary.diseaseCount,
				drugCount: summary.drugCount,
				relationCount: summary.relationCount,
			},
			"Health knowledge staging import completed",
		);
		console.log(JSON.stringify({ ok: true, summary }, null, 2));
		return true;
	} catch (error) {
		const validationError =
			error instanceof HealthKnowledgeImportValidationError;
		logger.error(
			{
				event: "health-knowledge.import.failed",
				errorType: safeErrorType(error),
				...(validationError
					? { code: "invalid-bundle", path: error.path }
					: { code: "staging-import-failed" }),
			},
			"Health knowledge staging import failed",
		);
		console.error(
			JSON.stringify(
				{
					ok: false,
					error: validationError
						? { code: "invalid-bundle", path: error.path }
						: { code: "staging-import-failed" },
				},
				null,
			),
		);
		return false;
	} finally {
		await pool?.end();
	}
}

if (import.meta.main) {
	const passed = await runHealthKnowledgeStagingImport();
	if (!passed) process.exitCode = 1;
}
