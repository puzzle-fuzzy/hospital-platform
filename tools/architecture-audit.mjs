import { fileURLToPath } from "node:url";

/**
 * Hospital Platform 架构边界审计。
 *
 * 这是仓库级 CLI 审计，不是 API/worker 运行时，因此只用标准输出报告结果；
 * 业务服务的运行日志仍必须统一通过 @hospital/observability 的 Pino 输出。
 * 这里刻意只检查不可妥协的边界，不把业务行为复制到验收脚本中。
 */

const repositoryRoot = new URL("../", import.meta.url);

/** 读取仓库源文件；审计失败时直接抛出，避免把缺失文件误判为通过。 */
async function readSource(relativePath) {
	return Bun.file(new URL(relativePath, repositoryRoot)).text();
}

const sources = Object.fromEntries(
	await Promise.all(
		[
			"apps/api/src/app.ts",
			"apps/api/src/application.ts",
			"apps/api/src/index.ts",
			"apps/api/src/modules/appointments/index.ts",
			"apps/api/src/modules/payments/index.ts",
			"apps/worker/src/runtime.ts",
			"apps/worker/src/index.ts",
			"apps/miniprogram/src/services/api-client.ts",
			"packages/observability/src/index.ts",
			"packages/persistence/src/runtime.ts",
			"packages/persistence/src/migrate.ts",
			"packages/domain/src/knowledge-import.ts",
			"packages/persistence/src/health-knowledge-import.ts",
		].map(async (relativePath) => [
			relativePath,
			await readSource(relativePath),
		]),
	),
);

/**
 * 小程序边界必须覆盖全部生产源码，而不能只抽查请求客户端；否则新页面可能绕过集中客户端重新引入旧直连。
 * 这里只读取文本源文件，不扫描构建产物和测试脚本，避免把验收中的禁止样例误判为生产代码。
 */
const miniprogramGlob = new Bun.Glob(
	"apps/miniprogram/src/**/*.{ts,js,wxml,wxss,json,jsonc}",
);
const miniprogramSourceFiles = [];
for await (const file of miniprogramGlob.scan({
	// 不能依赖调用者的当前目录，否则从仓库外执行可能扫描到空目录并产生假通过。
	cwd: fileURLToPath(repositoryRoot),
	onlyFiles: true,
})) {
	miniprogramSourceFiles.push(file);
}
const miniprogramSource = (
	await Promise.all(
		miniprogramSourceFiles.map((file) =>
			Bun.file(new URL(file.replaceAll("\\", "/"), repositoryRoot)).text(),
		),
	)
).join("\n");

/** 每条规则都有稳定名称，方便 CI 失败后按规则定位，而不是只看总分。 */
const checks = [];

function check(name, passed, reason) {
	checks.push({ name, passed, reason });
}

function contains(name, relativePath, fragment, reason) {
	check(name, sources[relativePath]?.includes(fragment) ?? false, reason);
}

function excludes(name, relativePath, fragment, reason) {
	check(name, !(sources[relativePath]?.includes(fragment) ?? true), reason);
}

contains(
	"observability.pino",
	"packages/observability/src/index.ts",
	"pino(",
	"业务日志必须由 Pino 统一创建。",
);
contains(
	"observability.redaction",
	"packages/observability/src/index.ts",
	"LOG_REDACT_PATHS",
	"敏感字段清单必须集中维护。",
);
excludes(
	"api.runtime.no-console",
	"apps/api/src/index.ts",
	"console.",
	"API 运行入口不能绕过 Pino 直接输出服务日志。",
);
excludes(
	"worker.runtime.no-console",
	"apps/worker/src/index.ts",
	"console.",
	"worker 运行入口不能绕过 Pino 直接输出服务日志。",
);

contains(
	"api.request-logging",
	"apps/api/src/app.ts",
	"requestLoggingPlugin(logger)",
	"HTTP 请求必须进入统一结构化请求日志。",
);
contains(
	"api.schema-gated-repositories",
	"apps/api/src/index.ts",
	"selectReadyRepositories",
	"MySQL repository 只能在真实 schema probe 通过后注入。",
);
contains(
	"api.fail-closed-defaults",
	"apps/api/src/application.ts",
	"createNotConfiguredRepositories",
	"缺少真实持久化时必须使用 fail-closed 实现。",
);
contains(
	"persistence.schema-gate",
	"packages/persistence/src/runtime.ts",
	"options.useRepositories",
	"持久化运行时不能绕过显式 schema gate。",
);
contains(
	"persistence.migration-manifest",
	"packages/persistence/src/migrate.ts",
	"PERSISTENCE_MIGRATIONS",
	"migration 必须有可审计的显式 manifest。",
);

/** 健康内容尚未完成真实 schema/审核导入前，患者端 route 必须保持未挂载。 */
excludes(
	"knowledge.route-not-registered",
	"apps/api/src/app.ts",
	"healthKnowledgeModule(",
	"健康知识路由必须等待真实内容审核与 staging 证据后再注册。",
);
contains(
	"knowledge.import-domain-validation",
	"packages/domain/src/knowledge-import.ts",
	"validateHealthKnowledgeImportBundle",
	"健康内容写入前必须通过 domain bundle validator。",
);
contains(
	"knowledge.import-transaction",
	"packages/persistence/src/health-knowledge-import.ts",
	"await connection.rollback()",
	"健康内容导入失败必须回滚，不能留下部分版本。",
);

/** 预约写入合同未完成前，路由文件只能注册 GET 目录/历史读取。 */
check(
	"appointments.read-only",
	!/\.(post|put|patch|delete)\s*\(/u.test(
		sources["apps/api/src/modules/appointments/index.ts"],
	),
	"预约写入、锁号、取消和挂号费仍保持未注册。",
);

for (const forbidden of [
	"api.weixin.qq.com",
	"httpZy",
	"VITE_ZHONGYI_BASE_API",
	"VITE_APP_WS_API",
	"providerPatientId",
	"providerReportId",
	"thirdPatientId",
	"patId",
	"proxyForward",
	"proxy/forward",
]) {
	check(
		`miniprogram.no-${forbidden}`,
		!miniprogramSource.includes(forbidden),
		"原生小程序全部生产源码只能访问 Hospital API，不能持有 provider 地址或内部引用。",
	);
}

/**
 * 外部小程序和 WebView 不是普通页面跳转：它们需要主体、受众、短期票据、回调校验和撤销策略。
 * 在这些 contract 与 Provider 文档冻结前，生产源码必须保持无入口，避免“先跳起来再补安全”的不可逆迁移。
 */
check(
	"miniprogram.no-unverified-external-entry",
	!["navigateToMiniProgram", "openEmbeddedMiniProgram", "<web-view"].some(
		(fragment) => miniprogramSource.includes(fragment),
	),
	"跨小程序和 WebView 入口必须等待独立安全 contract、allowlist 与回调验收后再开放。",
);

/**
 * 旧端曾在患者中心使用本地假患者和固定外部小程序标识；这些值一旦回流，
 * 就会绕过当前服务端 owner 校验，造成展示身份与真实业务身份分离。
 */
check(
	"miniprogram.no-legacy-patient-seed",
	![
		"931333214",
		"宋怀波",
		"张三",
		"BOUND_PATIENTS",
		"CURRENT_PATIENT",
		"wx0b76c9904392518f",
	].some((fragment) => miniprogramSource.includes(fragment)),
	"生产小程序不能携带旧端假患者、固定外部 AppID 或本地患者缓存标记。",
);

check(
	"miniprogram.payment-entry",
	sources["apps/miniprogram/src/services/api-client.ts"].includes(
		"wx.requestPayment",
	),
	"支付调起只能消费服务端白名单参数，且不等于业务成功。",
);

const failed = checks.filter(({ passed }) => !passed);
for (const result of checks) {
	console.log(
		`${result.passed ? "[PASS]" : "[FAIL]"} ${result.name} - ${result.reason}`,
	);
}

if (failed.length > 0) {
	console.error(`Architecture boundary audit failed: ${failed.length} rule(s)`);
	process.exitCode = 1;
} else {
	console.log(`Architecture boundary audit passed: ${checks.length} rule(s)`);
}
