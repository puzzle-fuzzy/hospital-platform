export type LogLevel = "debug" | "info" | "warn" | "error" | "silent";

export type RuntimeConfig = {
	/** 生产环境默认关闭 OpenAPI，避免无意暴露内部接口描述。 */
	environment: "development" | "test" | "production";
	host: string;
	port: number;
	apiVersion: string;
	/** 生产默认 info；测试可设 silent，开发默认 debug。 */
	logLevel: LogLevel;
	/** 目标 schema 完成 staging 验证后才允许注入真实 repository。 */
	persistenceSchemaReady: boolean;
	docsEnabled: boolean;
	corsOrigins: string[];
	databaseUrl: string | undefined;
	redisUrl: string | undefined;
	/** 只有显式打开并提供密钥时才接入真实微信 code2session。 */
	wechatIdentityReady: boolean;
	wechatAppId: string | undefined;
	wechatAppSecret: string | undefined;
	wechatIdentityBaseUrl: string;
	/** 微信支付 APIv3 仅在完整商户配置和人工验收后打开。 */
	wechatPaymentReady: boolean;
	wechatPayAppId: string | undefined;
	wechatPayMchId: string | undefined;
	wechatPayMerchantCertificateSerial: string | undefined;
	wechatPayMerchantPrivateKey: string | undefined;
	wechatPayPlatformCertificateSerial: string | undefined;
	wechatPayPlatformPublicKey: string | undefined;
	/** 微信 APIv3 密钥只用于通知解密，不得复用数据库密文密钥。 */
	wechatPayApiV3Key: string | undefined;
	wechatPayNotifyUrl: string | undefined;
	wechatPayBaseUrl: string;
	/** 众阳患者目录默认关闭；配置完整也不代表 provider 已联调。 */
	patientDirectoryReady: boolean;
	/** 预约 AMC 只读目录独立验收，不能随患者目录一起隐式打开。 */
	appointmentDirectoryReady: boolean;
	/** LIS/PACS/ECG 报告目录独立验收，不能随患者目录一起隐式打开。 */
	reportDirectoryReady: boolean;
	patientDirectoryBaseUrl: string | undefined;
	/** 可选的服务端 provider token；不能下发小程序或写入日志。 */
	patientDirectoryAuthorizationToken: string | undefined;
	/** 仅保护数据库中的短期支付调起参数，不是 APIv3 key。 */
	paymentDataEncryptionKey: string | undefined;
	/** worker 轮询持久化 outbox/查单计划的间隔，避免在进程内维护业务队列。 */
	workerPollIntervalMs: number;
};

/**
 * 配置状态只描述“开关与必填字段是否齐全”，不代表 provider 沙箱或生产
 * 联调已经通过；把 configured 和真实可用性分开，避免日志给出过度承诺。
 */
export type ProviderConfigurationStatus =
	| "disabled"
	| "configured"
	| "incomplete";

/** 供启动 preflight 展示的 provider 配置诊断；missingFields 只包含环境变量名。 */
export type ProviderConfigurationDiagnostic = {
	name:
		| "wechat-identity"
		| "wechat-payment"
		| "zhongyang-patient-directory"
		| "zhongyang-appointment-directory"
		| "zhongyang-report-directory";
	status: ProviderConfigurationStatus;
	missingFields: readonly string[];
};

type RequiredRuntimeField = {
	name: string;
	value: string | undefined;
};

function missingRuntimeFields(
	fields: readonly RequiredRuntimeField[],
): string[] {
	return fields.filter(({ value }) => !value).map(({ name }) => name);
}

function isHttpsUrl(value: string | undefined): boolean {
	if (!value) return false;
	try {
		return new URL(value).protocol === "https:";
	} catch {
		return false;
	}
}

/** 只返回环境变量名，绝不返回密钥、证书或 URL 的实际值。 */
export function wechatIdentityConfigurationMissingFields(
	runtimeConfig: RuntimeConfig,
): string[] {
	if (!runtimeConfig.wechatIdentityReady) return [];
	return missingRuntimeFields([
		{ name: "WECHAT_APPID", value: runtimeConfig.wechatAppId },
		{ name: "WECHAT_APP_SECRET", value: runtimeConfig.wechatAppSecret },
	]);
}

export function wechatIdentityConfigurationStatus(
	runtimeConfig: RuntimeConfig,
): ProviderConfigurationStatus {
	if (!runtimeConfig.wechatIdentityReady) return "disabled";
	return wechatIdentityConfigurationMissingFields(runtimeConfig).length === 0
		? "configured"
		: "incomplete";
}

/**
 * 微信支付 adapter 的组合根只依赖这一份字段检查；闸门打开但字段不完整
 * 时必须保持 fail-closed。通知 URL 还必须是 HTTPS，避免把 provider 回调
 * 配置成仅本机或明文 HTTP 地址。
 */
export function wechatPaymentConfigurationMissingFields(
	runtimeConfig: RuntimeConfig,
): string[] {
	if (!runtimeConfig.wechatPaymentReady) return [];
	const missing = missingRuntimeFields([
		{ name: "WECHAT_PAY_APP_ID", value: runtimeConfig.wechatPayAppId },
		{ name: "WECHAT_PAY_MCH_ID", value: runtimeConfig.wechatPayMchId },
		{
			name: "WECHAT_PAY_MERCHANT_CERTIFICATE_SERIAL",
			value: runtimeConfig.wechatPayMerchantCertificateSerial,
		},
		{
			name: "WECHAT_PAY_MERCHANT_PRIVATE_KEY",
			value: runtimeConfig.wechatPayMerchantPrivateKey,
		},
		{
			name: "WECHAT_PAY_PLATFORM_CERTIFICATE_SERIAL",
			value: runtimeConfig.wechatPayPlatformCertificateSerial,
		},
		{
			name: "WECHAT_PAY_PLATFORM_PUBLIC_KEY",
			value: runtimeConfig.wechatPayPlatformPublicKey,
		},
		{ name: "WECHAT_PAY_API_V3_KEY", value: runtimeConfig.wechatPayApiV3Key },
		{ name: "WECHAT_PAY_NOTIFY_URL", value: runtimeConfig.wechatPayNotifyUrl },
	]);
	if (
		runtimeConfig.wechatPayNotifyUrl &&
		!isHttpsUrl(runtimeConfig.wechatPayNotifyUrl) &&
		!missing.includes("WECHAT_PAY_NOTIFY_URL")
	) {
		missing.push("WECHAT_PAY_NOTIFY_URL(https)");
	}
	return missing;
}

export function wechatPaymentConfigurationStatus(
	runtimeConfig: RuntimeConfig,
): ProviderConfigurationStatus {
	if (!runtimeConfig.wechatPaymentReady) return "disabled";
	return wechatPaymentConfigurationMissingFields(runtimeConfig).length === 0
		? "configured"
		: "incomplete";
}

/**
 * 众阳患者目录只允许从服务端配置地址；生产环境禁止明文 HTTP，避免
 * unionId 和患者目录响应在 provider 链路上裸奔。授权方式仍以 provider
 * 合同为准，因此 token 是可选配置，不能把“有 token”误当作联调成功。
 */
export function patientDirectoryConfigurationMissingFields(
	runtimeConfig: RuntimeConfig,
): string[] {
	return zhongyangDirectoryConfigurationMissingFields(
		runtimeConfig,
		runtimeConfig.patientDirectoryReady,
	);
}

function zhongyangDirectoryConfigurationMissingFields(
	runtimeConfig: RuntimeConfig,
	ready: boolean,
): string[] {
	if (!ready) return [];
	const missing = missingRuntimeFields([
		{
			name: "ZHONGYANG_PATIENT_DIRECTORY_BASE_URL",
			value: runtimeConfig.patientDirectoryBaseUrl,
		},
	]);
	if (
		runtimeConfig.patientDirectoryBaseUrl &&
		!isHttpsUrl(runtimeConfig.patientDirectoryBaseUrl) &&
		!missing.includes("ZHONGYANG_PATIENT_DIRECTORY_BASE_URL")
	) {
		missing.push("ZHONGYANG_PATIENT_DIRECTORY_BASE_URL(https)");
	}
	return missing;
}

export function patientDirectoryConfigurationStatus(
	runtimeConfig: RuntimeConfig,
): ProviderConfigurationStatus {
	if (!runtimeConfig.patientDirectoryReady) return "disabled";
	return patientDirectoryConfigurationMissingFields(runtimeConfig).length === 0
		? "configured"
		: "incomplete";
}

export function appointmentDirectoryConfigurationMissingFields(
	runtimeConfig: RuntimeConfig,
): string[] {
	return zhongyangDirectoryConfigurationMissingFields(
		runtimeConfig,
		runtimeConfig.appointmentDirectoryReady,
	);
}

export function appointmentDirectoryConfigurationStatus(
	runtimeConfig: RuntimeConfig,
): ProviderConfigurationStatus {
	if (!runtimeConfig.appointmentDirectoryReady) return "disabled";
	return appointmentDirectoryConfigurationMissingFields(runtimeConfig)
		.length === 0
		? "configured"
		: "incomplete";
}

export function reportDirectoryConfigurationMissingFields(
	runtimeConfig: RuntimeConfig,
): string[] {
	return zhongyangDirectoryConfigurationMissingFields(
		runtimeConfig,
		runtimeConfig.reportDirectoryReady,
	);
}

export function reportDirectoryConfigurationStatus(
	runtimeConfig: RuntimeConfig,
): ProviderConfigurationStatus {
	if (!runtimeConfig.reportDirectoryReady) return "disabled";
	return reportDirectoryConfigurationMissingFields(runtimeConfig).length === 0
		? "configured"
		: "incomplete";
}

/**
 * 汇总所有已建配置闸门，供 API/worker preflight 复用同一套规则。
 * configured 只代表字段齐全；真实 provider 权限和联调仍必须单独验收。
 */
export function providerConfigurationDiagnostics(
	runtimeConfig: RuntimeConfig,
): readonly ProviderConfigurationDiagnostic[] {
	const entries = [
		{
			name: "wechat-identity" as const,
			status: wechatIdentityConfigurationStatus(runtimeConfig),
			missingFields: wechatIdentityConfigurationMissingFields(runtimeConfig),
		},
		{
			name: "wechat-payment" as const,
			status: wechatPaymentConfigurationStatus(runtimeConfig),
			missingFields: wechatPaymentConfigurationMissingFields(runtimeConfig),
		},
		{
			name: "zhongyang-patient-directory" as const,
			status: patientDirectoryConfigurationStatus(runtimeConfig),
			missingFields: patientDirectoryConfigurationMissingFields(runtimeConfig),
		},
		{
			name: "zhongyang-appointment-directory" as const,
			status: appointmentDirectoryConfigurationStatus(runtimeConfig),
			missingFields:
				appointmentDirectoryConfigurationMissingFields(runtimeConfig),
		},
		{
			name: "zhongyang-report-directory" as const,
			status: reportDirectoryConfigurationStatus(runtimeConfig),
			missingFields: reportDirectoryConfigurationMissingFields(runtimeConfig),
		},
	] satisfies readonly ProviderConfigurationDiagnostic[];
	return entries;
}

type RuntimeEnv = Record<string, string | undefined>;

function positivePort(value: string | undefined): number {
	if (!value) return 3000;

	const port = Number(value);
	if (Number.isInteger(port) && port > 0 && port < 65_536) return port;

	throw new Error("PORT must be an integer between 1 and 65535");
}

function positiveWorkerInterval(value: string | undefined): number {
	if (!value) return 1000;

	const interval = Number(value);
	if (Number.isInteger(interval) && interval >= 100 && interval <= 60_000) {
		return interval;
	}

	throw new Error(
		"WORKER_POLL_INTERVAL_MS must be an integer between 100 and 60000",
	);
}

function environment(value: string | undefined): RuntimeConfig["environment"] {
	if (value === "production" || value === "test") return value;
	return "development";
}

function boolean(value: string | undefined, fallback: boolean): boolean {
	if (!value) return fallback;
	return value === "true" || value === "1";
}

function optional(value: string | undefined): string | undefined {
	const normalized = value?.trim();
	return normalized ? normalized : undefined;
}

function origins(value: string | undefined): string[] {
	if (!value) return ["http://localhost:5173", "http://127.0.0.1:5173"];
	return value
		.split(",")
		.map((origin) => origin.trim())
		.filter(Boolean);
}

function logLevel(
	value: string | undefined,
	environmentValue: RuntimeConfig["environment"],
): LogLevel {
	if (
		value === "debug" ||
		value === "info" ||
		value === "warn" ||
		value === "error" ||
		value === "silent"
	) {
		return value;
	}
	if (environmentValue === "test") return "silent";
	return environmentValue === "production" ? "info" : "debug";
}

/**
 * 统一解析 API/worker 的运行配置。
 *
 * 传入 env 让单元测试和迁移脚本可以显式构造配置；生产入口只读取 Bun.env，
 * 不在业务模块内部散落读取环境变量，也不把密钥写进日志或 contracts。
 */
export function loadRuntimeConfig(env: RuntimeEnv): RuntimeConfig {
	const runtimeEnvironment = environment(env.NODE_ENV);
	return {
		environment: runtimeEnvironment,
		host: env.HOST ?? "127.0.0.1",
		port: positivePort(env.PORT),
		apiVersion: env.API_VERSION ?? "0.1.0",
		logLevel: logLevel(env.LOG_LEVEL, runtimeEnvironment),
		persistenceSchemaReady: boolean(env.PERSISTENCE_SCHEMA_READY, false),
		docsEnabled: boolean(env.DOCS_ENABLED, runtimeEnvironment !== "production"),
		corsOrigins: origins(env.CORS_ORIGINS),
		databaseUrl: optional(env.DATABASE_URL),
		redisUrl: optional(env.REDIS_URL),
		wechatIdentityReady: boolean(env.WECHAT_IDENTITY_READY, false),
		wechatAppId: optional(env.WECHAT_APPID),
		wechatAppSecret: optional(env.WECHAT_APP_SECRET),
		wechatIdentityBaseUrl:
			env.WECHAT_IDENTITY_BASE_URL ?? "https://api.weixin.qq.com",
		wechatPaymentReady: boolean(env.WECHAT_PAYMENT_READY, false),
		wechatPayAppId: optional(env.WECHAT_PAY_APP_ID),
		wechatPayMchId: optional(env.WECHAT_PAY_MCH_ID),
		wechatPayMerchantCertificateSerial: optional(
			env.WECHAT_PAY_MERCHANT_CERTIFICATE_SERIAL,
		),
		wechatPayMerchantPrivateKey: optional(env.WECHAT_PAY_MERCHANT_PRIVATE_KEY),
		wechatPayPlatformCertificateSerial: optional(
			env.WECHAT_PAY_PLATFORM_CERTIFICATE_SERIAL,
		),
		wechatPayPlatformPublicKey: optional(env.WECHAT_PAY_PLATFORM_PUBLIC_KEY),
		wechatPayApiV3Key: optional(env.WECHAT_PAY_API_V3_KEY),
		wechatPayNotifyUrl: optional(env.WECHAT_PAY_NOTIFY_URL),
		wechatPayBaseUrl:
			env.WECHAT_PAY_BASE_URL ?? "https://api.mch.weixin.qq.com",
		patientDirectoryReady: boolean(
			env.ZHONGYANG_PATIENT_DIRECTORY_READY,
			false,
		),
		appointmentDirectoryReady: boolean(
			env.ZHONGYANG_APPOINTMENT_DIRECTORY_READY,
			false,
		),
		reportDirectoryReady: boolean(env.ZHONGYANG_REPORT_DIRECTORY_READY, false),
		patientDirectoryBaseUrl: optional(env.ZHONGYANG_PATIENT_DIRECTORY_BASE_URL),
		patientDirectoryAuthorizationToken: optional(
			env.ZHONGYANG_PATIENT_DIRECTORY_AUTHORIZATION_TOKEN,
		),
		paymentDataEncryptionKey: optional(env.PAYMENT_DATA_ENCRYPTION_KEY),
		workerPollIntervalMs: positiveWorkerInterval(env.WORKER_POLL_INTERVAL_MS),
	};
}

/** API 和 worker 的进程入口共享这一份已解析配置。 */
export const config = loadRuntimeConfig(Bun.env);
