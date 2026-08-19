import pino, { type DestinationStream, type Logger as PinoLogger } from "pino";

export type { DestinationStream } from "pino";
export type AppLogger = PinoLogger;
export type LogLevel = "debug" | "info" | "warn" | "error" | "silent";

/**
 * Provider 失败事件允许记录的低敏诊断字段。
 *
 * 这些字段只用于把平台日志与 Provider 网关日志关联起来；Provider 原始
 * 响应、URL、请求体、患者号和凭证仍然禁止进入日志。业务模块不应自行
 * 读取 Error.message 来“补充上下文”，统一通过下面的白名单函数提取。
 */
export type ProviderFailureMetadata = {
	provider?: string;
	providerOperation?: string;
	providerRequestId?: string;
	providerStatusCode?: number;
	providerRetryable?: boolean;
};

/** Provider 返回的 request id 可能来自外部，先做长度和控制字符边界检查。 */
function safeProviderText(value: unknown): string | undefined {
	if (typeof value !== "string") return undefined;
	if (
		[...value].some((character) => {
			const code = character.charCodeAt(0);
			return code < 32 || code === 127;
		})
	) {
		return undefined;
	}
	const normalized = value.trim();
	if (!normalized || normalized.length > 128) {
		return undefined;
	}
	return normalized;
}

/**
 * 从 ProviderRequestError 提取跨业务模块一致的安全诊断元数据。
 *
 * 这里按错误名称和字段形状识别，避免 observability 包反向依赖 adapters；
 * 只有平台内部的 ProviderRequestError 才会带有这些字段，其他异常返回空对象。
 */
export function providerFailureMetadata(
	error: unknown,
): ProviderFailureMetadata {
	if (!(error instanceof Error) || error.name !== "ProviderRequestError") {
		return {};
	}
	const candidate = error as Error & {
		provider?: unknown;
		operation?: unknown;
		requestId?: unknown;
		statusCode?: unknown;
		retryable?: unknown;
	};
	const provider = safeProviderText(candidate.provider);
	const providerOperation = safeProviderText(candidate.operation);
	const providerRequestId = safeProviderText(candidate.requestId);
	const statusCode = candidate.statusCode;
	return {
		...(provider ? { provider } : {}),
		...(providerOperation ? { providerOperation } : {}),
		...(providerRequestId ? { providerRequestId } : {}),
		...(typeof statusCode === "number" &&
		Number.isInteger(statusCode) &&
		statusCode >= 100 &&
		statusCode <= 599
			? { providerStatusCode: statusCode }
			: {}),
		...(typeof candidate.retryable === "boolean"
			? { providerRetryable: candidate.retryable }
			: {}),
	};
}

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
	"unionId",
	"providerSubject",
	"provider_subject",
	"providerPatientId",
	"provider_patient_id",
	// 众阳患者档案字段：业务代码禁止记录原文，这里作为 Pino 序列化层的
	// 最终兜底，避免误传 Provider 响应时把 HIS patId 或患者身份字段落入日志。
	"patId",
	"pat_id",
	"thirdPatientId",
	"third_patient_id",
	"patName",
	"patientName",
	"cardNo",
	"medicalCardNo",
	"patCardNo",
	"cardPatCardNo",
	"originalPatCardNo",
	"idCardNo",
	"idcardNo",
	"phone",
	"contactTelephone",
	"contactName",
	"healthCardNumber",
	"patCardVOList",
	"providerReferences",
	"provider_references",
	"providerOrderId",
	"provider_order_id",
	"prepayId",
	"prepay_id",
	"payParams",
	"pay_params",
	"paySign",
	"nonceStr",
	"apiV3Key",
	"appSecret",
	"merchantPrivateKey",
	"platformPrivateKey",
	"privateKey",
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
	"*.unionId",
	"*.providerSubject",
	"*.provider_subject",
	"*.providerPatientId",
	"*.provider_patient_id",
	"*.patId",
	"*.pat_id",
	"*.thirdPatientId",
	"*.third_patient_id",
	"*.patName",
	"*.patientName",
	"*.cardNo",
	"*.medicalCardNo",
	"*.patCardNo",
	"*.cardPatCardNo",
	"*.originalPatCardNo",
	"*.idCardNo",
	"*.idcardNo",
	"*.phone",
	"*.contactTelephone",
	"*.contactName",
	"*.healthCardNumber",
	"*.patCardVOList",
	"*.providerReferences",
	"*.provider_references",
	"*.providerOrderId",
	"*.provider_order_id",
	"*.prepayId",
	"*.prepay_id",
	"*.payParams",
	"*.pay_params",
	"*.paySign",
	"*.nonceStr",
	"*.apiV3Key",
	"*.appSecret",
	"*.merchantPrivateKey",
	"*.platformPrivateKey",
	"*.privateKey",
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
