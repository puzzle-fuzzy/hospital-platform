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
	// Node 的 IncomingHttpHeaders 通常会把字段名标准化为小写，但手工构造
	// 的诊断对象、Provider SDK 和测试夹具不一定遵循这一点。Pino 的路径匹配
	// 区分大小写，因此标准 HTTP 写法也必须显式列出，不能假设“通常会小写”。
	"Authorization",
	"cookie",
	"Cookie",
	"headers.authorization",
	"headers.Authorization",
	"headers.cookie",
	"headers.Cookie",
	'headers["set-cookie"]',
	'headers["Set-Cookie"]',
	'headers["idempotency-key"]',
	'headers["Idempotency-Key"]',
	'headers["IDEMPOTENCY-KEY"]',
	'["Set-Cookie"]',
	'["Idempotency-Key"]',
	'["IDEMPOTENCY-KEY"]',
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
	"IDCardNo",
	"idCard",
	"IDCard",
	"identityCard",
	"identity_card",
	"birthday",
	"addr",
	"address",
	"nationalResidentIndexNo",
	"cityResidentIndexNo",
	"contactIdCardNo",
	"contactIdcardNo",
	"motherIdcard",
	"motherPhone",
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
	"*.Authorization",
	"*.cookie",
	"*.Cookie",
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
	"*.IDCardNo",
	"*.idCard",
	"*.IDCard",
	"*.identityCard",
	"*.identity_card",
	"*.birthday",
	"*.addr",
	"*.address",
	"*.nationalResidentIndexNo",
	"*.cityResidentIndexNo",
	"*.contactIdCardNo",
	"*.contactIdcardNo",
	"*.motherIdcard",
	"*.motherPhone",
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

/**
 * 需要从日志结构中递归移除原值的字段名。
 *
 * Pino 10 当前依赖的 @pinojs/redact 只支持固定层级的 `*`，不支持
 * `**.field` 无限递归路径。因此这里保留 Pino 的快速固定路径脱敏，同时在
 * 单行 JSON 输出边界按字段名递归处理，避免 Provider 多层响应留下隐私缺口。
 */
const LOG_REDACT_KEY_SET = new Set([
	"authorization",
	"Authorization",
	"cookie",
	"Cookie",
	"set-cookie",
	"Set-Cookie",
	"idempotency-key",
	"Idempotency-Key",
	"IDEMPOTENCY-KEY",
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
	"IDCardNo",
	"idCard",
	"IDCard",
	"identityCard",
	"identity_card",
	"birthday",
	"addr",
	"address",
	"nationalResidentIndexNo",
	"cityResidentIndexNo",
	"contactIdCardNo",
	"contactIdcardNo",
	"motherIdcard",
	"motherPhone",
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
]);
const LOG_REDACT_CENSOR = "[REDACTED]";

/** 递归复制已序列化的 JSON 值，并按字段名替换敏感值。 */
function redactNestedLogValue(value: unknown): unknown {
	if (Array.isArray(value)) {
		return value.map((item) => redactNestedLogValue(item));
	}
	if (value === null || typeof value !== "object") {
		return value;
	}

	const record: Record<string, unknown> = {};
	for (const [key, nestedValue] of Object.entries(value)) {
		record[key] = LOG_REDACT_KEY_SET.has(key)
			? LOG_REDACT_CENSOR
			: redactNestedLogValue(nestedValue);
	}
	return record;
}

/**
 * 在 Pino 已经生成单行 JSON 后做最终递归门禁。
 *
 * 选择输出边界而不是改写业务 logger 调用，是为了同时覆盖普通字段、child
 * bindings 和 serializer 产生的结构，并且不修改调用方传入的对象。Pino 始终
 * 输出合法 JSON；解析失败只作为防御性兜底保留原 chunk，不能替代业务层禁止
 * 记录原始报文的约束。
 */
function redactSerializedLogLine(serialized: string): string {
	try {
		return `${JSON.stringify(redactNestedLogValue(JSON.parse(serialized)))}\n`;
	} catch {
		return serialized;
	}
}

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
				censor: LOG_REDACT_CENSOR,
			},
			hooks: {
				streamWrite: redactSerializedLogLine,
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
