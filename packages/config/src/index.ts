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
	/** 仅保护数据库中的短期支付调起参数，不是 APIv3 key。 */
	paymentDataEncryptionKey: string | undefined;
	/** worker 轮询持久化 outbox/查单计划的间隔，避免在进程内维护业务队列。 */
	workerPollIntervalMs: number;
};

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
		paymentDataEncryptionKey: optional(env.PAYMENT_DATA_ENCRYPTION_KEY),
		workerPollIntervalMs: positiveWorkerInterval(env.WORKER_POLL_INTERVAL_MS),
	};
}

/** API 和 worker 的进程入口共享这一份已解析配置。 */
export const config = loadRuntimeConfig(Bun.env);
