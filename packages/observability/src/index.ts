import pino, { type DestinationStream, type Logger as PinoLogger } from "pino";

export type { DestinationStream } from "pino";
export {
	evaluateOperationalAlerts,
	OPERATIONAL_ALERT_THRESHOLDS,
	type OperationalAlert,
	type OperationalAlertCode,
	type OperationalAlertSeverity,
	type OperationalAlertSnapshot,
	OperationalAlertSnapshotError,
	type OperationalDependencyState,
} from "./operational-alerts";
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
	/** 仅记录有限枚举，便于区分本地校验、TLS/网络、HTTP 状态码和响应内容故障。 */
	providerFailureStage?: "validation" | "transport" | "http" | "response";
	/** 请求是否越过 Provider 边界；用于区分可安全重试和必须查单的失败。 */
	providerRequestOutcome?: "not_sent" | "rejected" | "unknown";
	/** 已确认的 Provider 业务竞争原因，不记录 Provider 原始响应。 */
	providerFailureReason?:
		| "appointment-source-unavailable"
		| "payment-order-not-found";
	/** Provider 错误响应的有限检索字段，不记录原始响应 body。 */
	providerErrorCode?: string;
	providerErrorMessage?: string;
	/**
	 * 传输层底层错误的有限枚举，例如证书过期或 DNS 失败。
	 * 只允许基础设施错误码，绝不把异常 message、URL 或证书内容写入日志。
	 */
	providerTransportErrorCode?: ProviderTransportErrorCode;
};

/**
 * Provider 传输失败的可检索错误码白名单。
 *
 * Bun/Node 的 TLS、DNS、连接和超时错误通常会通过 `cause.code` 暴露；
 * 这些码可以帮助定位 503 的基础设施根因，但未登记的错误码可能包含
 * 主机名、连接串或第三方 SDK 私有信息，所以必须保持 fail-closed。
 */
export type ProviderTransportErrorCode =
	| "CERT_HAS_EXPIRED"
	| "CERT_NOT_YET_VALID"
	| "ERR_TLS_CERT_ALTNAME_INVALID"
	| "SELF_SIGNED_CERT_IN_CHAIN"
	| "UNABLE_TO_VERIFY_LEAF_SIGNATURE"
	| "ENOTFOUND"
	| "EAI_AGAIN"
	| "ECONNREFUSED"
	| "ECONNRESET"
	| "ETIMEDOUT"
	| "UND_ERR_CONNECT_TIMEOUT"
	| "UND_ERR_SOCKET"
	| "ABORT_ERR";

const PROVIDER_TRANSPORT_ERROR_CODES: ReadonlySet<string> = new Set([
	"CERT_HAS_EXPIRED",
	"CERT_NOT_YET_VALID",
	"ERR_TLS_CERT_ALTNAME_INVALID",
	"SELF_SIGNED_CERT_IN_CHAIN",
	"UNABLE_TO_VERIFY_LEAF_SIGNATURE",
	"ENOTFOUND",
	"EAI_AGAIN",
	"ECONNREFUSED",
	"ECONNRESET",
	"ETIMEDOUT",
	"UND_ERR_CONNECT_TIMEOUT",
	"UND_ERR_SOCKET",
	"ABORT_ERR",
]);

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
		failureStage?: unknown;
		requestOutcome?: unknown;
		responseInvalid?: unknown;
		reason?: unknown;
		providerErrorCode?: unknown;
		providerErrorMessage?: unknown;
		cause?: unknown;
	};
	const provider = safeProviderText(candidate.provider);
	const providerOperation = safeProviderText(candidate.operation);
	const providerRequestId = safeProviderText(candidate.requestId);
	const statusCode = candidate.statusCode;
	// 老适配器的响应校验错误已经带有 `responseInvalid=true`，但早期构造点
	// 尚未显式填写阶段。这里保留向后兼容的推断，避免同一类 Provider 响应
	// 在不同业务模块的日志里出现字段缺失；显式阶段仍然拥有最高优先级。
	const failureStage =
		candidate.failureStage === "validation" ||
		candidate.failureStage === "transport" ||
		candidate.failureStage === "http" ||
		candidate.failureStage === "response"
			? candidate.failureStage
			: candidate.responseInvalid === true
				? "response"
				: undefined;
	const cause = candidate.cause;
	const causeCode =
		cause && typeof cause === "object" && "code" in cause
			? (cause as { code?: unknown }).code
			: undefined;
	const providerTransportErrorCode =
		failureStage === "transport" &&
		typeof causeCode === "string" &&
		PROVIDER_TRANSPORT_ERROR_CODES.has(causeCode)
			? (causeCode as ProviderTransportErrorCode)
			: undefined;
	const providerFailureReason =
		candidate.reason === "appointment-source-unavailable" ||
		candidate.reason === "payment-order-not-found"
			? candidate.reason
			: undefined;
	const providerErrorCode = safeProviderText(candidate.providerErrorCode);
	const providerErrorMessage = safeProviderText(candidate.providerErrorMessage);
	const providerRequestOutcome =
		candidate.requestOutcome === "not_sent" ||
		candidate.requestOutcome === "rejected" ||
		candidate.requestOutcome === "unknown"
			? candidate.requestOutcome
			: undefined;
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
		...(failureStage ? { providerFailureStage: failureStage } : {}),
		...(providerRequestOutcome ? { providerRequestOutcome } : {}),
		...(providerFailureReason ? { providerFailureReason } : {}),
		...(providerErrorCode ? { providerErrorCode } : {}),
		...(providerErrorMessage ? { providerErrorMessage } : {}),
		...(providerTransportErrorCode ? { providerTransportErrorCode } : {}),
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
	// Provider 的 Java/JSON 网关并不保证字段命名风格一致；camelCase 已经
	// 覆盖当前 adapter 的已知字段，下面的 snake_case 和常见移动端别名用于
	// 防止未来直接记录原始响应时，因为字段风格变化而绕过最终脱敏层。
	"patId",
	"pat_id",
	"thirdPatientId",
	"third_patient_id",
	"patName",
	"pat_name",
	"patientName",
	"patient_name",
	"displayName",
	"display_name",
	"cardNo",
	"card_no",
	"medicalCardNo",
	"medical_card_no",
	"medicalCardNumber",
	"medical_card_number",
	"patCardNo",
	"pat_card_no",
	"cardPatCardNo",
	"card_pat_card_no",
	"originalPatCardNo",
	"original_pat_card_no",
	"idCardNo",
	"id_card_no",
	"idcardNo",
	"idcard_no",
	"IDCardNo",
	"idCard",
	"IDCard",
	"id_card",
	"identityCard",
	"identity_card",
	"birthday",
	"addr",
	"address",
	"address_name",
	"nationalResidentIndexNo",
	"national_resident_index_no",
	"cityResidentIndexNo",
	"city_resident_index_no",
	"contactIdCardNo",
	"contact_id_card_no",
	"contactIdcardNo",
	"contact_idcard_no",
	"motherIdcard",
	"mother_idcard",
	"motherPhone",
	"mother_phone",
	"phone",
	"mobile",
	"mobilePhone",
	"mobile_phone",
	"phoneNumber",
	"phone_number",
	"contactTelephone",
	"contact_telephone",
	"contactName",
	"contact_name",
	"healthCardNumber",
	"health_card_number",
	"email",
	"emailAddress",
	"email_address",
	"patCardVOList",
	"pat_card_vo_list",
	"providerReferences",
	"provider_references",
	"providerOrderId",
	"provider_order_id",
	"providerRaw",
	"provider_raw",
	"providerRawPayload",
	"provider_raw_payload",
	"rawPayload",
	"raw_payload",
	"rawResponse",
	"raw_response",
	"requestBody",
	"request_body",
	"responseBody",
	"response_body",
	"body",
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
	"*.pat_name",
	"*.patientName",
	"*.patient_name",
	"*.displayName",
	"*.display_name",
	"*.cardNo",
	"*.card_no",
	"*.medicalCardNo",
	"*.medical_card_no",
	"*.medicalCardNumber",
	"*.medical_card_number",
	"*.patCardNo",
	"*.pat_card_no",
	"*.cardPatCardNo",
	"*.card_pat_card_no",
	"*.originalPatCardNo",
	"*.original_pat_card_no",
	"*.idCardNo",
	"*.id_card_no",
	"*.idcardNo",
	"*.idcard_no",
	"*.IDCardNo",
	"*.idCard",
	"*.IDCard",
	"*.id_card",
	"*.identityCard",
	"*.identity_card",
	"*.birthday",
	"*.addr",
	"*.address",
	"*.address_name",
	"*.nationalResidentIndexNo",
	"*.national_resident_index_no",
	"*.cityResidentIndexNo",
	"*.city_resident_index_no",
	"*.contactIdCardNo",
	"*.contact_id_card_no",
	"*.contactIdcardNo",
	"*.contact_idcard_no",
	"*.motherIdcard",
	"*.mother_idcard",
	"*.motherPhone",
	"*.mother_phone",
	"*.phone",
	"*.mobile",
	"*.mobilePhone",
	"*.mobile_phone",
	"*.phoneNumber",
	"*.phone_number",
	"*.contactTelephone",
	"*.contact_telephone",
	"*.contactName",
	"*.contact_name",
	"*.healthCardNumber",
	"*.health_card_number",
	"*.email",
	"*.emailAddress",
	"*.email_address",
	"*.patCardVOList",
	"*.pat_card_vo_list",
	"*.providerReferences",
	"*.provider_references",
	"*.providerOrderId",
	"*.provider_order_id",
	"*.providerRaw",
	"*.provider_raw",
	"*.providerRawPayload",
	"*.provider_raw_payload",
	"*.rawPayload",
	"*.raw_payload",
	"*.rawResponse",
	"*.raw_response",
	"*.requestBody",
	"*.request_body",
	"*.responseBody",
	"*.response_body",
	"*.body",
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
 * `**.field` 无限递归路径。因此这里从同一份 Pino 路径清单派生字段名，
 * 再在单行 JSON 输出边界递归处理，避免 Provider 多层响应留下隐私缺口，
 * 也避免新增脱敏字段时维护两套可能漂移的列表。
 */
function redactKeyFromPath(path: string): string | undefined {
	const bracketMatch = path.match(/\[["']([^"']+)["']\]$/);
	if (bracketMatch?.[1]) return bracketMatch[1];
	const lastSegment = path.split(".").at(-1);
	return lastSegment && lastSegment !== "*" ? lastSegment : undefined;
}

const LOG_REDACT_KEY_SET = new Set(
	LOG_REDACT_PATHS.map(redactKeyFromPath).filter((key): key is string =>
		Boolean(key),
	),
);
const LOG_REDACT_CENSOR = "[REDACTED]";
const LOG_REDACTION_FAILURE_LINE = `${JSON.stringify({
	level: 50,
	event: "log.redaction.failed",
	errorType: "serialized-json-invalid",
	msg: "Log record discarded by redaction boundary",
})}\n`;

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
 * bindings 和 serializer 产生的结构，并且不修改调用方传入的对象。Pino 正常
 * 始终输出合法 JSON；如果异常 chunk 无法解析，必须丢弃原文并输出固定的安全
 * 事件，不能为了保留排障信息而把未经脱敏的原 chunk 放行。
 */
export function redactSerializedLogLine(serialized: string): string {
	try {
		return `${JSON.stringify(redactNestedLogValue(JSON.parse(serialized)))}\n`;
	} catch {
		return LOG_REDACTION_FAILURE_LINE;
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
