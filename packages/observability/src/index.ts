import { createHash } from "node:crypto";
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
 * 管理端日志只读视图的安全元数据。
 *
 * 这个模型故意没有 request/response body 字段。医保、身份和支付报文可能
 * 包含证件号、令牌和资金信息，不能通过浏览器管理菜单批量暴露；需要核验
 * 原文时仍应按受控 trace 导出规范从 journald 取证。
 */
export type AdminLogLevel = "debug" | "info" | "warn" | "error";
export type AdminLogSource = "process" | "database";
export type AdminLogRecord = {
	id: string;
	timestamp: string;
	level: AdminLogLevel;
	source: AdminLogSource;
	service: string;
	environment: string;
	event?: string;
	method?: string;
	path?: string;
	statusCode?: number;
	durationMs?: number;
	requestId?: string;
	traceId?: string;
	errorName?: string;
	errorCode?: string;
	dependency?: string;
	provider?: string;
	providerOperation?: string;
	providerRequestId?: string;
	providerStatusCode?: number;
	providerFailureStage?: string;
	providerRequestOutcome?: string;
	providerRetryable?: boolean;
	providerErrorCode?: string;
	providerErrorMessageLength?: number;
	providerErrorMessageSha256?: string;
	providerTransportErrorCode?: string;
	providerResponseBusinessSuccess?: boolean;
	providerResponseCode?: string;
	providerResponseBodyByteLength?: number;
	providerResponseBodySha256?: string;
	providerResponseMessageLength?: number;
	persistenceOperation?: string;
	/** 固定值：本读模型不记录请求或返回原文。 */
	parameterVisibility: "not-recorded";
};

/** 进程之间转发时允许携带的安全日志字段；不包含 id/source 或任何原文。 */
export type AdminLogRecordPayload = Omit<AdminLogRecord, "id" | "source">;

export type AdminLogQuery = {
	page?: number;
	pageSize?: number;
	level?: AdminLogLevel;
	event?: string;
	path?: string;
	traceId?: string;
	requestId?: string;
	providerRequestId?: string;
	providerOperation?: string;
	service?: string;
	startTime?: string;
	endTime?: string;
};

export type AdminLogPage = {
	items: readonly AdminLogRecord[];
	total: number;
	page: number;
	pageSize: number;
	source: AdminLogSource;
	parameterPolicy: "safe-metadata-only";
};

export type AdminLogStore = {
	append(serialized: string): void;
	query(query?: AdminLogQuery): AdminLogPage;
	getById(id: string): AdminLogRecord | undefined;
};

const ADMIN_LOG_MAX_TEXT = 256;

function adminLogText(value: unknown): string | undefined {
	if (typeof value !== "string") return undefined;
	const normalized = value.trim();
	if (
		!normalized ||
		normalized.length > ADMIN_LOG_MAX_TEXT ||
		[...normalized].some((character) => {
			const code = character.charCodeAt(0);
			return code < 32 || code === 127;
		})
	) {
		return undefined;
	}
	return normalized;
}

function adminLogNumber(value: unknown): number | undefined {
	return typeof value === "number" && Number.isFinite(value)
		? value
		: undefined;
}

function adminLogLevel(value: unknown): AdminLogLevel | undefined {
	if (
		value === "debug" ||
		value === "info" ||
		value === "warn" ||
		value === "error"
	) {
		return value;
	}
	if (typeof value !== "number") return undefined;
	if (value >= 50) return "error";
	if (value >= 40) return "warn";
	if (value >= 30) return "info";
	if (value >= 10) return "debug";
	return undefined;
}

function adminLogTimestamp(value: unknown): string | undefined {
	const candidate =
		typeof value === "number"
			? new Date(value).toISOString()
			: adminLogText(value);
	if (!candidate) return undefined;
	const parsed = Date.parse(candidate);
	return Number.isNaN(parsed) ? undefined : new Date(parsed).toISOString();
}

export function parseAdminLogLine(
	serialized: string,
): AdminLogRecordPayload | undefined {
	let parsed: Record<string, unknown>;
	try {
		const value = JSON.parse(serialized) as unknown;
		if (!value || typeof value !== "object" || Array.isArray(value))
			return undefined;
		parsed = value as Record<string, unknown>;
	} catch {
		return undefined;
	}
	const level = adminLogLevel(parsed.level);
	const timestamp = adminLogTimestamp(parsed.time ?? parsed.timestamp);
	const service = adminLogText(parsed.service);
	const environment = adminLogText(parsed.environment);
	if (!level || !timestamp || !service || !environment) return undefined;
	const textFields = [
		"event",
		"method",
		"path",
		"requestId",
		"traceId",
		"errorName",
		"errorCode",
		"dependency",
		"provider",
		"providerOperation",
		"providerRequestId",
		"providerFailureStage",
		"providerRequestOutcome",
		"providerErrorCode",
		"providerErrorMessageSha256",
		"providerTransportErrorCode",
		"providerResponseCode",
		"persistenceOperation",
	] as const;
	const fields: Partial<AdminLogRecord> = {};
	for (const field of textFields) {
		const value = adminLogText(parsed[field]);
		if (value) fields[field] = value;
	}
	for (const field of [
		"statusCode",
		"providerStatusCode",
		"providerErrorMessageLength",
		"providerResponseBodyByteLength",
		"providerResponseMessageLength",
	] as const) {
		const value = adminLogNumber(parsed[field]);
		if (value !== undefined && Number.isInteger(value)) fields[field] = value;
	}
	for (const field of [
		"providerRetryable",
		"providerResponseBusinessSuccess",
	] as const) {
		const value = parsed[field];
		if (typeof value === "boolean") fields[field] = value;
	}
	const durationMs = adminLogNumber(parsed.durationMs);
	if (durationMs !== undefined && durationMs >= 0)
		fields.durationMs = durationMs;
	return {
		timestamp,
		level,
		service,
		environment,
		...fields,
		parameterVisibility: "not-recorded",
	};
}

function adminLogRecordFromLine(
	serialized: string,
	id: string,
): AdminLogRecord | undefined {
	const payload = parseAdminLogLine(serialized);
	return payload ? { id, source: "process", ...payload } : undefined;
}

/** 进程内有界日志窗口；不会持久化，也不会把原始报文写入读模型。 */
export function createAdminLogStore(maxEntries = 500): AdminLogStore {
	const entries: AdminLogRecord[] = [];
	let sequence = 0;
	const capacity =
		Number.isInteger(maxEntries) && maxEntries > 0 ? maxEntries : 500;
	return {
		append(serialized) {
			const record = adminLogRecordFromLine(serialized, `log-${++sequence}`);
			if (!record) return;
			entries.unshift(record);
			if (entries.length > capacity) entries.length = capacity;
		},
		query(query = {}) {
			const page =
				Number.isInteger(query.page) && (query.page ?? 0) > 0
					? (query.page ?? 1)
					: 1;
			const pageSize =
				Number.isInteger(query.pageSize) && (query.pageSize ?? 0) > 0
					? Math.min(query.pageSize ?? 50, 100)
					: 50;
			const start = query.startTime ? Date.parse(query.startTime) : undefined;
			const end = query.endTime ? Date.parse(query.endTime) : undefined;
			const filtered = entries.filter((entry) => {
				if (query.level && entry.level !== query.level) return false;
				if (query.event && entry.event !== query.event) return false;
				if (query.path && !entry.path?.includes(query.path)) return false;
				if (query.traceId && entry.traceId !== query.traceId) return false;
				if (query.requestId && entry.requestId !== query.requestId)
					return false;
				if (
					query.providerRequestId &&
					entry.providerRequestId !== query.providerRequestId
				)
					return false;
				if (
					query.providerOperation &&
					entry.providerOperation !== query.providerOperation
				)
					return false;
				if (query.service && entry.service !== query.service) return false;
				const timestamp = Date.parse(entry.timestamp);
				if (start !== undefined && !Number.isNaN(start) && timestamp < start)
					return false;
				if (end !== undefined && !Number.isNaN(end) && timestamp > end)
					return false;
				return true;
			});
			const offset = (page - 1) * pageSize;
			return {
				items: filtered.slice(offset, offset + pageSize),
				total: filtered.length,
				page,
				pageSize,
				source: "process",
				parameterPolicy: "safe-metadata-only",
			};
		},
		getById(id) {
			return entries.find((entry) => entry.id === id);
		},
	};
}

/** 把同一行同时送入有界读模型和原有 stdout/journald 目的地。 */
export function createAdminLogDestination(
	store: AdminLogStore,
	destination: DestinationStream,
): DestinationStream {
	return {
		write(chunk: string) {
			store.append(chunk);
			destination.write(chunk);
		},
	};
}

/**
 * 将 Worker 的安全日志元数据转发到 API 的内部 ingest 路由。
 *
 * 先解析并投影白名单字段，再发起 HTTP 请求；即使 PROVIDER_RAW_LOGGING 打开，
 * 也不会把 provider.request.raw/provider.response.raw 原文跨进程转发。转发失败
 * 不影响 stdout/journald，后台原始取证仍以 journald 为准。
 */
export function createAdminLogForwardingDestination(
	destination: DestinationStream,
	options: {
		url: string;
		token: string;
		timeoutMs?: number;
		fetcher?: (input: string, init: RequestInit) => Promise<Response>;
	},
): DestinationStream {
	const url = options.url.trim();
	const token = options.token.trim();
	if (!url || !token) return destination;
	const target = new URL(url);
	if (target.protocol !== "http:" && target.protocol !== "https:") {
		throw new Error("ADMIN_LOGS_INGEST_URL must use HTTP or HTTPS");
	}
	const fetcher = options.fetcher ?? fetch;
	const timeoutMs =
		Number.isInteger(options.timeoutMs) && (options.timeoutMs ?? 0) > 0
			? Math.min(options.timeoutMs ?? 2_000, 10_000)
			: 2_000;
	let forwarding = Promise.resolve();
	let pendingForwardCount = 0;

	return {
		write(chunk: string) {
			destination.write(chunk);
			for (const line of chunk.split("\n")) {
				const payload = parseAdminLogLine(line.trim());
				if (!payload) continue;
				// 原始日志的 body 在 journald 受控保留，但不应跨进程转发；
				// 即使这里只发送元数据，也跳过 raw 事件对应的 chunk。
				if (payload.event?.includes(".raw")) continue;
				// API 暂时不可用或 Worker 突发大量日志时不无限堆积 Promise；
				// 被丢弃的只是菜单副本，stdout/journald 仍保留完整证据。
				if (pendingForwardCount >= 256) continue;
				pendingForwardCount += 1;
				forwarding = forwarding
					.catch(() => undefined)
					.then(async () => {
						const controller = new AbortController();
						const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
						try {
							await fetcher(url, {
								method: "POST",
								headers: {
									"content-type": "application/json",
									"x-admin-token": token,
								},
								body: JSON.stringify(payload),
								signal: controller.signal,
							});
						} finally {
							clearTimeout(timeoutId);
						}
					})
					.catch(() => undefined)
					.finally(() => {
						pendingForwardCount -= 1;
					});
			}
		},
	};
}

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
	/** 已确认的 Provider/医保流程边界原因，不记录 Provider 原始响应。 */
	providerFailureReason?:
		| "appointment-source-unavailable"
		| "payment-order-not-found"
		| "medical-insurance-payment-in-progress"
		| "medical-insurance-cancellation-context-missing";
	/** Provider 错误响应的有限检索字段，不记录原始响应 body 或错误正文。 */
	providerErrorCode?: string;
	providerErrorMessageLength?: number;
	providerErrorMessageSha256?: string;
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

function providerMessageFingerprint(value: string): {
	providerErrorMessageLength: number;
	providerErrorMessageSha256: string;
} {
	return {
		providerErrorMessageLength: value.length,
		providerErrorMessageSha256: createHash("sha256")
			.update(value)
			.digest("hex")
			.slice(0, 16),
	};
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
		candidate.reason === "payment-order-not-found" ||
		candidate.reason === "medical-insurance-payment-in-progress" ||
		candidate.reason === "medical-insurance-cancellation-context-missing"
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
		...(providerErrorMessage
			? providerMessageFingerprint(providerErrorMessage)
			: {}),
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
