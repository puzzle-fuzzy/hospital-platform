import pino, { type DestinationStream, type Logger as PinoLogger } from "pino";

export type { DestinationStream } from "pino";
export type AppLogger = PinoLogger;
export type LogLevel = "debug" | "info" | "warn" | "error" | "silent";

/**
 * 统一的敏感路径清单；Pino 会在序列化前替换这些字段，避免凭证进入 JSON 日志。
 * 业务日志仍然不应直接传入完整 request body 或 provider 原始报文。
 */
export const LOG_REDACT_PATHS = [
	"authorization",
	"cookie",
	"headers.authorization",
	"headers.cookie",
	'headers["set-cookie"]',
	'headers["idempotency-key"]',
	"password",
	"secret",
	"token",
	"accessToken",
	"refreshToken",
	"session_key",
	"sessionKey",
	"openid",
	"unionid",
	"providerSubject",
	"provider_subject",
	"providerPatientId",
	"provider_patient_id",
	"idempotencyKey",
	"*.authorization",
	"*.cookie",
	"*.password",
	"*.secret",
	"*.token",
	"*.accessToken",
	"*.refreshToken",
	"*.session_key",
	"*.sessionKey",
	"*.openid",
	"*.unionid",
	"*.providerSubject",
	"*.provider_subject",
	"*.providerPatientId",
	"*.provider_patient_id",
	"*.idempotencyKey",
] as const;

export type LoggerOptions = {
	service: string;
	environment: string;
	level?: LogLevel;
	destination?: DestinationStream;
};

/** 创建服务级 Pino logger；默认输出 ISO 时间戳和单行 JSON。 */
export function createLogger(options: LoggerOptions): AppLogger {
	return pino(
		{
			base: {
				service: options.service,
				environment: options.environment,
			},
			level: options.level ?? "info",
			timestamp: pino.stdTimeFunctions.isoTime,
			redact: {
				paths: [...LOG_REDACT_PATHS],
				censor: "[REDACTED]",
			},
		},
		options.destination,
	);
}

/** 测试和本地静默组合使用 Pino 自身的 silent level，不自定义第二套 logger。 */
export function createNoopLogger(): AppLogger {
	return createLogger({
		service: "hospital-test",
		environment: "test",
		level: "silent",
	});
}
