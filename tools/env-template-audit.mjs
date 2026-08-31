import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";

const repositoryRoot = resolve(import.meta.dirname, "..");

/**
 * 根模板服务开发/测试和本地 Worker，systemd 模板只服务生产 API。
 * 两者不能强行使用同一份值，但公共配置名、生产安全默认值和敏感值占位符
 * 必须受到同一个静态门禁约束，避免把开发模板误当成生产环境文件。
 */
export const environmentTemplateFiles = {
	development: ".env.example",
	production: "infra/systemd/api.env.example",
};

/** API 两份模板都必须登记的配置名；Worker 专属变量不放进生产 API 模板。 */
export const sharedTemplateKeys = [
	"NODE_ENV",
	"HOST",
	"PORT",
	"API_VERSION",
	"DOCS_ENABLED",
	"LOG_LEVEL",
	"PERSISTENCE_SCHEMA_READY",
	"PERSISTENCE_MIGRATION_ALLOW_REMOTE",
	"PERSISTENCE_MIGRATION_ALLOW_PRODUCTION",
	"CORS_ORIGINS",
	"DATABASE_URL",
	"REDIS_URL",
	"WECHAT_IDENTITY_READY",
	"WECHAT_APPID",
	"WECHAT_APP_SECRET",
	"WECHAT_IDENTITY_BASE_URL",
	"WECHAT_PAYMENT_READY",
	"WECHAT_PAY_APP_ID",
	"WECHAT_PAY_MCH_ID",
	"WECHAT_PAY_MERCHANT_CERTIFICATE_SERIAL",
	"WECHAT_PAY_MERCHANT_PRIVATE_KEY",
	"WECHAT_PAY_PLATFORM_CERTIFICATE_SERIAL",
	"WECHAT_PAY_PLATFORM_PUBLIC_KEY",
	"WECHAT_PAY_API_V3_KEY",
	"WECHAT_PAY_NOTIFY_URL",
	"WECHAT_PAY_BASE_URL",
	"ZHONGYANG_PATIENT_DIRECTORY_READY",
	"ZHONGYANG_APPOINTMENT_DIRECTORY_READY",
	"ZHONGYANG_APPOINTMENT_RECORDS_READY",
	"ZHONGYANG_MEDICAL_RECORDS_READY",
	"ZHONGYANG_OUTPATIENT_PAYMENT_READY",
	"OUTPATIENT_PAYMENT_AUTH_SYS_CODE",
	"ZHONGYANG_REPORT_DIRECTORY_READY",
	"ZHONGYANG_REPORT_DETAIL_READY",
	"ZHONGYANG_BASE_URL",
	"ZHONGYANG_AUTHORIZATION_TOKEN",
	"PAYMENT_DATA_ENCRYPTION_KEY",
];

const developmentOnlyKeys = [
	"WORKER_POLL_INTERVAL_MS",
	"API_BASE_URL",
	"REDIS_SESSION_AUDIT_URL",
];

const productionExactValues = {
	NODE_ENV: "production",
	DOCS_ENABLED: "false",
	LOG_LEVEL: "info",
	PERSISTENCE_MIGRATION_ALLOW_REMOTE: "false",
	PERSISTENCE_MIGRATION_ALLOW_PRODUCTION: "false",
	WECHAT_PAYMENT_READY: "false",
	ZHONGYANG_PATIENT_DIRECTORY_READY: "false",
	ZHONGYANG_APPOINTMENT_DIRECTORY_READY: "false",
	ZHONGYANG_APPOINTMENT_RECORDS_READY: "false",
	ZHONGYANG_MEDICAL_RECORDS_READY: "false",
	ZHONGYANG_OUTPATIENT_PAYMENT_READY: "false",
	ZHONGYANG_REPORT_DIRECTORY_READY: "false",
	ZHONGYANG_REPORT_DETAIL_READY: "false",
};

const developmentExactValues = {
	NODE_ENV: "development",
	DOCS_ENABLED: "true",
	LOG_LEVEL: "debug",
	PERSISTENCE_SCHEMA_READY: "false",
	PERSISTENCE_MIGRATION_ALLOW_REMOTE: "false",
	PERSISTENCE_MIGRATION_ALLOW_PRODUCTION: "false",
	WECHAT_PAYMENT_READY: "false",
};

const productionPlaceholderKeys = [
	"DATABASE_URL",
	"REDIS_URL",
	"WECHAT_APPID",
	"WECHAT_APP_SECRET",
];

function parseTemplate(content, label, failures) {
	const values = {};
	const duplicates = [];
	for (const [index, line] of content.split(/\r?\n/u).entries()) {
		const trimmed = line.trim();
		if (!trimmed || trimmed.startsWith("#")) continue;
		const match = trimmed.match(/^([A-Z][A-Z0-9_]*)=(.*)$/u);
		if (!match) {
			failures.push(`${label} 第 ${index + 1} 行不是合法 KEY=VALUE 配置`);
			continue;
		}
		const [, key, value] = match;
		if (key in values) duplicates.push(key);
		values[key] = value;
	}
	if (duplicates.length > 0) {
		failures.push(`${label} 存在重复配置：${duplicates.join(", ")}`);
	}
	return values;
}

function checkExactValues(values, expected, label, failures) {
	for (const [key, expectedValue] of Object.entries(expected)) {
		if (values[key] !== expectedValue) {
			failures.push(
				`${label} ${key} 必须固定为 ${expectedValue}，当前为 ${values[key] ?? "<缺失>"}`,
			);
		}
	}
}

function checkKeys(values, expected, label, failures) {
	const expectedSet = new Set(expected);
	for (const key of expected) {
		if (!(key in values)) failures.push(`${label} 缺少 ${key}`);
	}
	for (const key of Object.keys(values)) {
		if (!expectedSet.has(key)) failures.push(`${label} 不应包含 ${key}`);
	}
}

/** 审计开发模板和生产 API 模板的配置职责、默认值和敏感占位符。 */
export function auditEnvironmentTemplates({
	developmentTemplate,
	productionTemplate,
}) {
	const failures = [];
	const development = parseTemplate(
		developmentTemplate,
		".env.example",
		failures,
	);
	const production = parseTemplate(
		productionTemplate,
		"infra/systemd/api.env.example",
		failures,
	);

	checkKeys(
		development,
		[...sharedTemplateKeys, ...developmentOnlyKeys],
		".env.example",
		failures,
	);
	checkKeys(
		production,
		sharedTemplateKeys,
		"infra/systemd/api.env.example",
		failures,
	);
	checkExactValues(
		development,
		developmentExactValues,
		".env.example",
		failures,
	);
	checkExactValues(
		production,
		productionExactValues,
		"infra/systemd/api.env.example",
		failures,
	);

	for (const key of productionPlaceholderKeys) {
		if (!production[key]?.includes("<")) {
			failures.push(
				`infra/systemd/api.env.example ${key} 必须保留占位符，禁止放入真实凭据`,
			);
		}
	}
	for (const [key, value] of Object.entries(production)) {
		if (/(localhost|127\.0\.0\.1)/iu.test(value)) {
			failures.push(
				`infra/systemd/api.env.example ${key} 不得使用本机地址：${value}`,
			);
		}
	}

	return {
		passed: failures.length === 0,
		failures,
		developmentOnlyKeys,
		sharedKeyCount: sharedTemplateKeys.length,
	};
}

/** 执行模板审计；只读，不读取真实环境文件。 */
export async function auditEnvironmentTemplateFiles(
	rootDirectory = repositoryRoot,
) {
	const [developmentTemplate, productionTemplate] = await Promise.all([
		readFile(join(rootDirectory, environmentTemplateFiles.development), "utf8"),
		readFile(join(rootDirectory, environmentTemplateFiles.production), "utf8"),
	]);
	return auditEnvironmentTemplates({ developmentTemplate, productionTemplate });
}

if (import.meta.main) {
	try {
		const result = await auditEnvironmentTemplateFiles();
		console.log(JSON.stringify(result, null, 2));
		if (!result.passed) process.exitCode = 1;
	} catch (error) {
		console.error(
			`环境模板审计失败：${error instanceof Error ? error.message : "未知错误"}`,
		);
		process.exitCode = 2;
	}
}
