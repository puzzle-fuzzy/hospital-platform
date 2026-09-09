import { createHash } from "node:crypto";
import type { AdapterContext, AdapterName } from "./context";
import { ProviderRequestError, type ProviderRequestOutcome } from "./errors";

/** provider 默认超时；具体 adapter 可以按官方协议覆盖，但不得无限等待。 */
const DEFAULT_PROVIDER_TIMEOUT_MS = 15_000;

/**
 * journald/采集器对单条日志大小存在实现差异；原始报文按字符分块，避免
 * 一条过大的 JSON 日志被采集器静默丢弃。块按 index/total/hash 关联，仍可
 * 在日志平台按 traceId + event 重组为完整报文。
 */
const RAW_LOG_CHUNK_MAX_JSON_BYTES = 1_500;

/**
 * journald 会把含 C1/格式/私用区等不可打印 Unicode 的 MESSAGE 导出为字节
 * 数组；常用的 `.MESSAGE | fromjson` 随后会把整条 raw 事件漏掉。仅在原文
 * 含这类字符时改用 JSON string literal 编码，拼接所有 chunk 后执行一次
 * `JSON.parse` 即可无损还原原文。
 */
const JOURNAL_UNSAFE_CHARACTER =
	/[\p{Cc}\p{Cf}\p{Cs}\p{Co}\p{Cn}\p{Zl}\p{Zp}]/u;
const JOURNAL_UNSAFE_SERIALIZED_CHARACTER =
	/[\p{Cc}\p{Cf}\p{Cs}\p{Co}\p{Cn}\p{Zl}\p{Zp}]/gu;

/**
 * Provider 响应关联号的公共边界。
 *
 * 外部响应头不是 TypeScript 类型安全区：空白值、控制字符或超长文本如果
 * 直接进入 `ProviderRequestError`，后续 service 可能无法生成合法 trace，
 * 日志也会丢失与本次平台请求的关联。异常响应头回退到服务端 traceId，
 * 保留可检索性，同时不把未经校验的外部字符串当成业务事实。
 */
const MAX_PROVIDER_REQUEST_ID_LENGTH = 128;

/**
 * Provider HTTP 边界的日志能力只依赖这三个方法，避免 adapters 反向依赖
 * observability。生产组合根把 Pino 注入这里后，所有调用 requestJson 的
 * adapter 都会自动得到同一套请求/响应审计事件。
 */
export type ProviderRequestLogger = {
	info(bindings: object, message?: string): void;
	warn(bindings: object, message?: string): void;
	error(bindings: object, message?: string): void;
};

let defaultProviderRequestLogger: ProviderRequestLogger | undefined;

/** 由 API 组合根调用一次；测试可以传入 silent logger。 */
export function configureProviderRequestLogger(
	logger: ProviderRequestLogger | undefined,
): void {
	defaultProviderRequestLogger = logger;
}

/**
 * 受控联调开关：打开后 requestJson 会记录 Provider 的完整请求/响应原文。
 * 默认关闭，联调结束后必须移除环境变量并重启服务。
 */
export function providerRawLoggingEnabled(): boolean {
	const value = Bun.env.PROVIDER_RAW_LOGGING?.trim().toLowerCase();
	return value === "1" || value === "true" || value === "yes";
}

export function rawBodyText(value: unknown): string | undefined {
	if (value === undefined) return undefined;
	if (typeof value === "string") return value;
	try {
		return JSON.stringify(value);
	} catch {
		return "[unserializable-provider-body]";
	}
}

function rawHeadersText(headers: Headers): string {
	return JSON.stringify(Object.fromEntries(headers.entries()));
}

const SENSITIVE_FIELD_PARTS = [
	"id",
	"idno",
	"openid",
	"unionid",
	"name",
	"token",
	"auth",
	"secret",
	"key",
	"sign",
	"cipher",
	"encrypt",
	"credential",
	"password",
	"phone",
	"mobile",
	"card",
	"cert",
	"session",
	"ec",
] as const;

function isSensitiveField(field: string): boolean {
	const normalized = field.replaceAll(/[^a-zA-Z0-9]/g, "").toLowerCase();
	return SENSITIVE_FIELD_PARTS.some((part) => normalized.includes(part));
}

function shortSha256(value: string | Uint8Array): string {
	return createHash("sha256").update(value).digest("hex").slice(0, 16);
}

function safeStringShape(
	value: string,
	sensitive: boolean,
): Record<string, unknown> {
	return {
		kind: "string",
		length: value.length,
		...(sensitive ? { sensitive: true } : { sha256: shortSha256(value) }),
	};
}

/**
 * 记录完整的 JSON 结构，但不记录任何原始值。
 *
 * 这里 deliberately 保留字段名、嵌套关系、数组数量、字符串长度和非敏感
 * 字符串指纹，足以定位“字段缺失/包装层错误/数组为空/前后响应不一致”，
 * 同时不会把身份证、姓名、医保 token、授权码或签名写进 journald。
 */
function safeValueShape(
	value: unknown,
	fieldName = "",
	depth = 0,
	seen = new WeakSet<object>(),
): unknown {
	if (depth > 6) return { kind: "truncated", reason: "max-depth" };
	if (value === null) return { kind: "null" };
	if (value === undefined) return { kind: "undefined" };
	if (typeof value === "string") {
		return safeStringShape(value, isSensitiveField(fieldName));
	}
	if (typeof value === "number") {
		return { kind: "number", finite: Number.isFinite(value) };
	}
	if (typeof value === "boolean") return { kind: "boolean" };
	if (typeof value === "bigint") return { kind: "bigint" };
	if (typeof value === "function") return { kind: "function" };
	if (typeof value !== "object") return { kind: typeof value };
	if (seen.has(value)) return { kind: "circular" };
	seen.add(value);

	if (Array.isArray(value)) {
		return {
			kind: "array",
			count: value.length,
			items: value
				.slice(0, 20)
				.map((item) => safeValueShape(item, fieldName, depth + 1, seen)),
			...(value.length > 20 ? { truncatedItems: value.length - 20 } : {}),
		};
	}

	const record = value as Record<string, unknown>;
	const keys = Object.keys(record).sort();
	const fields = Object.fromEntries(
		keys
			.slice(0, 120)
			.map((key) => [key, safeValueShape(record[key], key, depth + 1, seen)]),
	);
	return {
		kind: "object",
		keys: keys.slice(0, 120),
		fields,
		...(keys.length > 120 ? { truncatedFields: keys.length - 120 } : {}),
	};
}

function safeUrlShape(rawUrl: string): Record<string, unknown> {
	try {
		const url = new URL(rawUrl);
		return {
			origin: url.origin,
			pathnameLength: url.pathname.length,
			pathnameSha256: shortSha256(url.pathname),
			queryKeys: [...new Set(url.searchParams.keys())].sort(),
		};
	} catch {
		return { kind: "invalid-url", length: rawUrl.length };
	}
}

function safeHeaderShape(headers: Headers): Record<string, unknown> {
	const names = [...headers.keys()].sort();
	return {
		names,
		sensitiveNames: names.filter((name) => isSensitiveField(name)),
	};
}

function safeRawBodyShape(raw: string): Record<string, unknown> {
	if (!raw) return { kind: "empty", byteLength: 0 };
	try {
		return {
			kind: "json",
			byteLength: new TextEncoder().encode(raw).byteLength,
			sha256: shortSha256(raw),
			shape: safeValueShape(JSON.parse(raw)),
		};
	} catch {
		return {
			kind: "text",
			byteLength: new TextEncoder().encode(raw).byteLength,
			sha256: shortSha256(raw),
		};
	}
}

type ProviderResponseDetails = {
	code?: string;
	message?: string;
	success?: boolean;
};

function boundedProviderResponseText(
	value: unknown,
	maxLength: number,
): string | undefined {
	const candidate =
		typeof value === "string"
			? value
			: typeof value === "number" && Number.isFinite(value)
				? String(value)
				: undefined;
	if (candidate === undefined) return undefined;
	if (
		[...candidate].some((character) => {
			const code = character.charCodeAt(0);
			return code < 32 || code === 127;
		})
	) {
		return undefined;
	}
	const normalized = candidate.trim();
	return normalized && normalized.length <= maxLength ? normalized : undefined;
}

/** 提取顶层及有限 data 包装层中的业务结果，错误码允许数字形式。 */
function providerResponseDetails(raw: string): ProviderResponseDetails {
	if (!raw) return {};
	let current: unknown;
	try {
		current = JSON.parse(raw);
	} catch {
		return {};
	}

	const result: ProviderResponseDetails = {};
	for (let depth = 0; depth < 4; depth += 1) {
		if (
			typeof current !== "object" ||
			current === null ||
			Array.isArray(current)
		) {
			break;
		}
		const record = current as Record<string, unknown>;
		if (result.success === undefined && typeof record.success === "boolean") {
			result.success = record.success;
		}
		if (result.code === undefined) {
			const code = boundedProviderResponseText(record.code, 128);
			if (code !== undefined) result.code = code;
		}
		if (result.message === undefined) {
			const message = boundedProviderResponseText(record.message, 512);
			if (message !== undefined) result.message = message;
		}
		current = record.data;
	}
	return result;
}

function emitRawBodyLog(
	logger: ProviderRequestLogger | undefined,
	bindings: Record<string, unknown>,
	bodyField: "providerRequestBodyText" | "providerResponseBodyText",
	body: string,
	message: string,
): void {
	const textEncoder = new TextEncoder();
	const encoding = JOURNAL_UNSAFE_CHARACTER.test(body)
		? "json-string-v1"
		: "plain";
	const encodedBody =
		encoding === "json-string-v1"
			? JSON.stringify(body).replace(
					JOURNAL_UNSAFE_SERIALIZED_CHARACTER,
					(character) => {
						const codePoint = character.codePointAt(0) ?? 0;
						if (codePoint <= 0xffff) {
							return `\\u${codePoint.toString(16).padStart(4, "0")}`;
						}
						const supplementary = codePoint - 0x10000;
						const high = 0xd800 + (supplementary >> 10);
						const low = 0xdc00 + (supplementary & 0x3ff);
						return `\\u${high.toString(16)}\\u${low.toString(16)}`;
					},
				)
			: body;
	const chunks: string[] = [];
	if (encodedBody.length === 0) {
		chunks.push("");
	} else {
		let chunk = "";
		let chunkJsonBytes = 2;
		for (const character of encodedBody) {
			const serializedCharacter = JSON.stringify(character).slice(1, -1);
			const characterJsonBytes =
				textEncoder.encode(serializedCharacter).byteLength;
			if (
				chunk &&
				chunkJsonBytes + characterJsonBytes > RAW_LOG_CHUNK_MAX_JSON_BYTES
			) {
				chunks.push(chunk);
				chunk = "";
				chunkJsonBytes = 2;
			}
			chunk += character;
			chunkJsonBytes += characterJsonBytes;
		}
		if (chunk) chunks.push(chunk);
	}
	const byteLength = textEncoder.encode(body).byteLength;
	const encodedByteLength = textEncoder.encode(encodedBody).byteLength;
	const bodySha256 = shortSha256(body);
	for (const [index, chunk] of chunks.entries()) {
		emitProviderLog(
			logger,
			"info",
			{
				...bindings,
				[bodyField]: chunk,
				[`${bodyField}Encoding`]: encoding,
				[`${bodyField}ChunkIndex`]: index,
				[`${bodyField}ChunkCount`]: chunks.length,
				[`${bodyField}ByteLength`]: byteLength,
				[`${bodyField}EncodedByteLength`]: encodedByteLength,
				[`${bodyField}Sha256`]: bodySha256,
			},
			message,
		);
	}
}

function emitProviderLog(
	logger: ProviderRequestLogger | undefined,
	level: "info" | "warn" | "error",
	bindings: Record<string, unknown>,
	message: string,
): void {
	logger?.[level](bindings, message);
}

/** 统一的 provider 请求输入，禁止让业务层自行拼接认证和幂等请求头。 */
export type ProviderRequest = {
	provider: AdapterName;
	operation: string;
	url: string;
	method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
	context: AdapterContext;
	headers?: Record<string, string>;
	body?: unknown;
	/** 已完成签名的 JSON；与 body 互斥，保证签名报文和线上 body 字节一致。 */
	bodyText?: string;
	/** provider-specific response verifier；只在 HTTP 2xx 且解析 JSON 前执行。 */
	verifyResponse?: (input: {
		rawBody: Uint8Array;
		headers: Headers;
		statusCode: number;
		requestId: string;
	}) => void | Promise<void>;
	/** 仅供明确的内部审计存储场景保留 JSON 响应原文。 */
	captureRawBody?: boolean;
	/** 单次调用覆盖；未传时使用组合根配置的统一 provider logger。 */
	logger?: ProviderRequestLogger;
};

export type ProviderResponse<T> = {
	data: T;
	statusCode: number;
	requestId: string;
	/** JSON HTTP body原文；仅在请求显式开启 captureRawBody 时存在。 */
	rawBodyText?: string;
};

export type ProviderFetcher = (
	input: RequestInfo | URL,
	init?: RequestInit,
) => Promise<Response>;

function timeoutFor(context: AdapterContext): number {
	return context.timeoutMs && context.timeoutMs > 0
		? context.timeoutMs
		: DEFAULT_PROVIDER_TIMEOUT_MS;
}

function responseRequestId(headers: Headers, fallback: string): string {
	for (const headerName of ["x-request-id", "Wechatpay-Request-Id"]) {
		const value = headers.get(headerName);
		if (value === null) continue;
		const normalized = value.trim();
		if (
			!normalized ||
			normalized.length > MAX_PROVIDER_REQUEST_ID_LENGTH ||
			Array.from(normalized).some((character) => {
				const code = character.charCodeAt(0);
				return code < 0x20 || code === 0x7f;
			})
		) {
			continue;
		}
		return normalized;
	}
	return fallback;
}

/**
 * 只提取 Provider 错误响应中可用于检索的有限字段。
 *
 * 原始响应可能包含凭证、患者信息或超长文本，不能写入异常和日志；
 * 这里也不把错误 body 作为业务数据向上层传播，只保留 code/message。
 */
function responseErrorDetails(raw: string): ProviderResponseDetails {
	return providerResponseDetails(raw);
}

export async function requestJson<T>(
	input: ProviderRequest,
	fetcher: ProviderFetcher = fetch,
): Promise<ProviderResponse<T>> {
	const logger = input.logger ?? defaultProviderRequestLogger;
	const headers = new Headers(input.headers);
	headers.set("accept", "application/json");
	headers.set("x-request-id", input.context.traceId);
	headers.set("idempotency-key", input.context.idempotencyKey);
	if (input.body !== undefined || input.bodyText !== undefined) {
		headers.set("content-type", "application/json");
	}
	const auditBase = {
		provider: input.provider,
		operation: input.operation,
		traceId: input.context.traceId,
		requestId: input.context.traceId,
		method: input.method,
		url: safeUrlShape(input.url),
		headers: safeHeaderShape(headers),
		bodyShape: safeValueShape(
			input.body !== undefined ? input.body : input.bodyText,
		),
	};
	if (input.body !== undefined && input.bodyText !== undefined) {
		emitProviderLog(
			logger,
			"error",
			{
				event: "provider.request.invalid",
				...auditBase,
				failureStage: "validation",
			},
			"Provider request rejected before dispatch",
		);
		throw new ProviderRequestError({
			provider: input.provider,
			operation: input.operation,
			message: "Provider request cannot define both body and bodyText",
			retryable: false,
			failureStage: "validation",
			requestOutcome: "not_sent",
		});
	}

	const controller = new AbortController();
	const timeoutId = setTimeout(
		() => controller.abort(),
		timeoutFor(input.context),
	);
	const onAbort = () => controller.abort();
	if (input.context.signal?.aborted) {
		controller.abort();
	} else {
		input.context.signal?.addEventListener("abort", onAbort, { once: true });
	}

	const init: RequestInit = {
		method: input.method,
		headers,
		signal: controller.signal,
	};
	if (input.body !== undefined || input.bodyText !== undefined) {
		init.body = input.bodyText ?? JSON.stringify(input.body);
	}

	try {
		if (controller.signal.aborted) {
			throw new ProviderRequestError({
				provider: input.provider,
				operation: input.operation,
				message: "Provider request was cancelled before dispatch",
				// 请求尚未跨出 Provider 边界，取消只影响本次调用；上层可
				// 在新的请求上下文中安全重试，不应被当成 unknown。
				retryable: true,
				failureStage: "validation",
				requestOutcome: "not_sent",
			});
		}

		if (providerRawLoggingEnabled()) {
			const requestBody = rawBodyText(input.bodyText ?? input.body) ?? "";
			emitRawBodyLog(
				logger,
				{
					event: "provider.request.raw",
					provider: input.provider,
					operation: input.operation,
					traceId: input.context.traceId,
					providerRequestId: input.context.traceId,
					method: input.method,
					providerRequestUrl: input.url,
					providerRequestHeadersText: rawHeadersText(headers),
				},
				"providerRequestBodyText",
				requestBody,
				"Provider raw request captured for test diagnostics",
			);
		}

		emitProviderLog(
			logger,
			"info",
			{ event: "provider.request.dispatched", ...auditBase },
			"Provider request dispatched",
		);

		const response = await fetcher(input.url, init);
		const rawBody = new Uint8Array(await response.arrayBuffer());
		const raw = new TextDecoder().decode(rawBody);
		const requestId = responseRequestId(
			response.headers,
			input.context.traceId,
		);
		const responseDetails = responseErrorDetails(raw);
		const responseLevel =
			response.status >= 400 || responseDetails.success === false
				? "warn"
				: "info";
		emitProviderLog(
			logger,
			responseLevel,
			{
				event: "provider.response.observed",
				...auditBase,
				providerRequestId: requestId,
				providerStatusCode: response.status,
				providerResponseBodyByteLength: new TextEncoder().encode(raw)
					.byteLength,
				providerResponseBodySha256: shortSha256(raw),
				...(responseDetails.success !== undefined
					? { providerResponseBusinessSuccess: responseDetails.success }
					: {}),
				...(responseDetails.code
					? { providerResponseCode: responseDetails.code }
					: {}),
				...(responseDetails.message
					? {
							providerResponseMessageShape: safeStringShape(
								responseDetails.message,
								true,
							),
						}
					: {}),
			},
			"Provider response observed",
		);
		if (providerRawLoggingEnabled()) {
			emitRawBodyLog(
				logger,
				{
					event: "provider.response.raw",
					provider: input.provider,
					operation: input.operation,
					traceId: input.context.traceId,
					providerRequestId: requestId,
					providerStatusCode: response.status,
					providerResponseHeadersText: rawHeadersText(response.headers),
				},
				"providerResponseBodyText",
				raw,
				"Provider raw response captured for test diagnostics",
			);
		}
		emitProviderLog(
			logger,
			"info",
			{
				event: "provider.response.received",
				...auditBase,
				providerRequestId: requestId,
				providerStatusCode: response.status,
				...(responseDetails.success !== undefined
					? { providerResponseBusinessSuccess: responseDetails.success }
					: {}),
				...(responseDetails.code
					? { providerResponseCode: responseDetails.code }
					: {}),
				...(responseDetails.message
					? {
							providerResponseMessageShape: safeStringShape(
								responseDetails.message,
								true,
							),
						}
					: {}),
				providerResponseHeaders: safeHeaderShape(response.headers),
				responseShape: safeRawBodyShape(raw),
			},
			"Provider response received",
		);

		if (!response.ok) {
			const errorDetails = responseErrorDetails(raw);
			const requestOutcome: ProviderRequestOutcome =
				response.status >= 400 &&
				response.status < 500 &&
				response.status !== 429
					? "rejected"
					: "unknown";
			const error = new ProviderRequestError({
				provider: input.provider,
				operation: input.operation,
				message: `Provider request failed with status ${response.status}`,
				requestId,
				statusCode: response.status,
				retryable: response.status === 429 || response.status >= 500,
				failureStage: "http",
				requestOutcome,
				...(errorDetails.code ? { providerErrorCode: errorDetails.code } : {}),
				// 微信 ORDER_NOT_EXIST 的现有重试分支需要保留其业务文案；众阳等
				// 医疗接口不把 Provider 原文放入异常对象，避免身份证/姓名/凭证
				// 等内容通过错误序列化泄漏。原始响应结构仍由服务端审计日志记录。
				...(input.provider === "wechat-pay" && errorDetails.message
					? { providerErrorMessage: errorDetails.message }
					: {}),
			});
			emitProviderLog(
				logger,
				"warn",
				{
					event: "provider.request.failed",
					...auditBase,
					providerRequestId: requestId,
					providerStatusCode: response.status,
					failureStage: "http",
					requestOutcome,
					providerErrorCode: errorDetails.code,
					providerErrorMessageShape: errorDetails.message
						? safeStringShape(errorDetails.message, true)
						: undefined,
				},
				"Provider request failed with an HTTP error",
			);
			throw error;
		}

		if (input.verifyResponse) {
			try {
				await input.verifyResponse({
					rawBody,
					headers: response.headers,
					statusCode: response.status,
					requestId,
				});
			} catch (cause) {
				if (cause instanceof ProviderRequestError) throw cause;
				emitProviderLog(
					logger,
					"error",
					{
						event: "provider.request.failed",
						...auditBase,
						providerRequestId: requestId,
						providerStatusCode: response.status,
						failureStage: "response",
						errorName: cause instanceof Error ? cause.name : "UnknownError",
					},
					"Provider response verification failed",
				);

				throw new ProviderRequestError({
					provider: input.provider,
					operation: input.operation,
					message: "Provider response verification failed",
					requestId,
					retryable: false,
					failureStage: "response",
					requestOutcome: "unknown",
					cause,
				});
			}
		}

		if (!raw) {
			return {
				data: undefined as T,
				statusCode: response.status,
				requestId,
				...(input.captureRawBody ? { rawBodyText: raw } : {}),
			};
		}

		try {
			return {
				data: JSON.parse(raw) as T,
				statusCode: response.status,
				requestId,
				...(input.captureRawBody ? { rawBodyText: raw } : {}),
			};
		} catch (cause) {
			emitProviderLog(
				logger,
				"error",
				{
					event: "provider.request.failed",
					...auditBase,
					providerRequestId: requestId,
					providerStatusCode: response.status,
					failureStage: "response",
					errorName: cause instanceof Error ? cause.name : "UnknownError",
				},
				"Provider response was not valid JSON",
			);
			throw new ProviderRequestError({
				provider: input.provider,
				operation: input.operation,
				message: "Provider response was not valid JSON",
				requestId,
				retryable: false,
				failureStage: "response",
				requestOutcome: "unknown",
				cause,
			});
		}
	} catch (cause) {
		if (cause instanceof ProviderRequestError) {
			emitProviderLog(
				logger,
				cause.failureStage === "transport" ? "error" : "warn",
				{
					event: "provider.request.failed",
					...auditBase,
					providerRequestId: cause.requestId,
					providerStatusCode: cause.statusCode,
					failureStage: cause.failureStage,
					requestOutcome: cause.requestOutcome,
					errorName: cause.name,
					providerErrorCode: cause.providerErrorCode,
					providerErrorMessageShape: cause.providerErrorMessage
						? safeStringShape(cause.providerErrorMessage, true)
						: undefined,
				},
				"Provider request failed",
			);
			throw cause;
		}
		emitProviderLog(
			logger,
			"error",
			{
				event: "provider.request.failed",
				...auditBase,
				providerRequestId: input.context.traceId,
				failureStage: "transport",
				errorName: cause instanceof Error ? cause.name : "UnknownError",
			},
			"Provider request could not be completed",
		);

		throw new ProviderRequestError({
			provider: input.provider,
			operation: input.operation,
			message: controller.signal.aborted
				? "Provider request timed out or was cancelled"
				: "Provider request could not be completed",
			// 传输层失败没有 Provider 响应头，不能获得对方 requestId；
			// 使用本次服务端 traceId 作为 fallback，确保业务失败日志、HTTP
			// 请求日志和客户端反馈仍能通过同一个关联号串起来。它不是
			// Provider 已确认的请求号，因此只作为低敏诊断字段使用。
			requestId: input.context.traceId,
			retryable: true,
			failureStage: "transport",
			requestOutcome: "unknown",
			cause,
		});
	} finally {
		clearTimeout(timeoutId);
		input.context.signal?.removeEventListener("abort", onAbort);
	}
}
