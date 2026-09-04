import type { AdapterContext, AdapterName } from "./context";
import { ProviderRequestError, type ProviderRequestOutcome } from "./errors";

/** provider 默认超时；具体 adapter 可以按官方协议覆盖，但不得无限等待。 */
const DEFAULT_PROVIDER_TIMEOUT_MS = 15_000;

/**
 * Provider 响应关联号的公共边界。
 *
 * 外部响应头不是 TypeScript 类型安全区：空白值、控制字符或超长文本如果
 * 直接进入 `ProviderRequestError`，后续 service 可能无法生成合法 trace，
 * 日志也会丢失与本次平台请求的关联。异常响应头回退到服务端 traceId，
 * 保留可检索性，同时不把未经校验的外部字符串当成业务事实。
 */
const MAX_PROVIDER_REQUEST_ID_LENGTH = 128;

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
};

export type ProviderResponse<T> = {
	data: T;
	statusCode: number;
	requestId: string;
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
function responseErrorDetails(raw: string): {
	code?: string;
	message?: string;
} {
	if (!raw) return {};
	let parsed: unknown;
	try {
		parsed = JSON.parse(raw);
	} catch {
		return {};
	}
	if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
		return {};
	}
	const record = parsed as Record<string, unknown>;
	const bounded = (value: unknown, maxLength: number): string | undefined => {
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
		return normalized && normalized.length <= maxLength
			? normalized
			: undefined;
	};
	const code = bounded(record.code, 64);
	const message = bounded(record.message, 256);
	return {
		...(code ? { code } : {}),
		...(message ? { message } : {}),
	};
}

export async function requestJson<T>(
	input: ProviderRequest,
	fetcher: ProviderFetcher = fetch,
): Promise<ProviderResponse<T>> {
	if (input.body !== undefined && input.bodyText !== undefined) {
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

	const headers = new Headers(input.headers);
	headers.set("accept", "application/json");
	headers.set("x-request-id", input.context.traceId);
	headers.set("idempotency-key", input.context.idempotencyKey);

	const init: RequestInit = {
		method: input.method,
		headers,
		signal: controller.signal,
	};
	if (input.body !== undefined || input.bodyText !== undefined) {
		headers.set("content-type", "application/json");
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

		const response = await fetcher(input.url, init);
		const rawBody = new Uint8Array(await response.arrayBuffer());
		const raw = new TextDecoder().decode(rawBody);
		const requestId = responseRequestId(
			response.headers,
			input.context.traceId,
		);

		if (!response.ok) {
			const errorDetails = responseErrorDetails(raw);
			const requestOutcome: ProviderRequestOutcome =
				response.status >= 400 &&
				response.status < 500 &&
				response.status !== 429
					? "rejected"
					: "unknown";
			throw new ProviderRequestError({
				provider: input.provider,
				operation: input.operation,
				message: `Provider request failed with status ${response.status}`,
				requestId,
				statusCode: response.status,
				retryable: response.status === 429 || response.status >= 500,
				failureStage: "http",
				requestOutcome,
				...(errorDetails.code ? { providerErrorCode: errorDetails.code } : {}),
				...(errorDetails.message
					? { providerErrorMessage: errorDetails.message }
					: {}),
			});
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
			return { data: undefined as T, statusCode: response.status, requestId };
		}

		try {
			return {
				data: JSON.parse(raw) as T,
				statusCode: response.status,
				requestId,
			};
		} catch (cause) {
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
		if (cause instanceof ProviderRequestError) throw cause;

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
