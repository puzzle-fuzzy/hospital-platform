import type { LogLevel } from "@hospital/observability";

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
};

function positivePort(value: string | undefined): number {
	if (!value) return 3000;

	const port = Number(value);
	if (Number.isInteger(port) && port > 0 && port < 65_536) return port;

	throw new Error("PORT must be an integer between 1 and 65535");
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
	environment: RuntimeConfig["environment"],
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
	if (environment === "test") return "silent";
	return environment === "production" ? "info" : "debug";
}

const runtimeEnvironment = environment(Bun.env.NODE_ENV);

export const config: RuntimeConfig = {
	environment: runtimeEnvironment,
	host: Bun.env.HOST ?? "127.0.0.1",
	port: positivePort(Bun.env.PORT),
	apiVersion: Bun.env.API_VERSION ?? "0.1.0",
	logLevel: logLevel(Bun.env.LOG_LEVEL, runtimeEnvironment),
	persistenceSchemaReady: boolean(Bun.env.PERSISTENCE_SCHEMA_READY, false),
	docsEnabled: boolean(
		Bun.env.DOCS_ENABLED,
		runtimeEnvironment !== "production",
	),
	corsOrigins: origins(Bun.env.CORS_ORIGINS),
	databaseUrl: optional(Bun.env.DATABASE_URL),
	redisUrl: optional(Bun.env.REDIS_URL),
	wechatIdentityReady: boolean(Bun.env.WECHAT_IDENTITY_READY, false),
	wechatAppId: optional(Bun.env.WECHAT_APPID),
	wechatAppSecret: optional(Bun.env.WECHAT_APP_SECRET),
	wechatIdentityBaseUrl:
		Bun.env.WECHAT_IDENTITY_BASE_URL ?? "https://api.weixin.qq.com",
};
