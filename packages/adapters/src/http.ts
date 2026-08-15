import type { AdapterContext, AdapterName } from "./context";
import { ProviderRequestError } from "./errors";

/** provider 默认超时；具体 adapter 可以按官方协议覆盖，但不得无限等待。 */
const DEFAULT_PROVIDER_TIMEOUT_MS = 15_000;

/** 统一的 provider 请求输入，禁止让业务层自行拼接认证和幂等请求头。 */
export type ProviderRequest = {
	provider: AdapterName;
	operation: string;
	url: string;
	method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
	context: AdapterContext;
	headers?: Record<string, string>;
	body?: unknown;
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

export async function requestJson<T>(
	input: ProviderRequest,
	fetcher: ProviderFetcher = fetch,
): Promise<ProviderResponse<T>> {
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
	if (input.body !== undefined) {
		headers.set("content-type", "application/json");
		init.body = JSON.stringify(input.body);
	}

	try {
		if (controller.signal.aborted) {
			throw new Error("Provider request was cancelled before dispatch");
		}

		const response = await fetcher(input.url, init);
		const raw = await response.text();
		const requestId =
			response.headers.get("x-request-id") ?? input.context.traceId;

		if (!response.ok) {
			throw new ProviderRequestError({
				provider: input.provider,
				operation: input.operation,
				message: `Provider request failed with status ${response.status}`,
				statusCode: response.status,
				retryable: response.status === 429 || response.status >= 500,
			});
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
				retryable: false,
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
			retryable: true,
			cause,
		});
	} finally {
		clearTimeout(timeoutId);
		input.context.signal?.removeEventListener("abort", onAbort);
	}
}
