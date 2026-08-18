import { ProviderRequestError } from "@hospital/adapters";
import {
	DependencyNotConfiguredError,
	ExternalTraceReadModelValidationError,
	PatientDirectorySnapshotResultValidationError,
	PaymentOrderReadModelValidationError,
	PaymentQuoteReadModelValidationError,
} from "@hospital/domain";
import {
	type AppLogger,
	providerFailureMetadata,
} from "@hospital/observability";
import { PersistenceUnavailableError } from "@hospital/persistence";
import { Elysia } from "elysia";
import { SessionPrincipalReadModelValidationError } from "../modules/auth/service";

const requestStartTimes = new WeakMap<Request, number>();
const requestErrors = new WeakMap<Request, ErrorMetadata>();

type ErrorMetadata = {
	errorName: string;
	errorCode?: string;
	/** 仅记录 provider 的低敏诊断字段，不记录 URL、请求体或响应体。 */
	provider?: string;
	providerOperation?: string;
	providerRequestId?: string;
	providerStatusCode?: number;
	providerRetryable?: boolean;
	/** 持久化内部操作分类，不包含 SQL、连接串或原始错误消息。 */
	persistenceOperation?: PersistenceUnavailableError["operation"];
	/** 仅允许列表中的连接/传输层错误码。 */
	persistenceErrorCode?: string;
	dependency?: string;
	/** 持久化读模型固定违规原因，不携带字段原值或数据库内容。 */
	readModelViolation?: string;
};

function statusCode(value: number | string | undefined): number {
	return typeof value === "number" ? value : 200;
}

function requestPath(request: Request): string {
	return new URL(request.url).pathname;
}

function requestFields(
	request: Request,
	status: number,
	durationMs: number,
	event = status >= 400 ? "http.request.failed" : "http.request.completed",
) {
	const requestId = request.headers.get("x-request-id") ?? "unknown";
	return {
		event,
		requestId,
		traceId: requestId,
		method: request.method,
		path: requestPath(request),
		statusCode: status,
		durationMs,
		idempotencyKeyPresent: request.headers.has("idempotency-key"),
	};
}

function durationFor(request: Request): number {
	const startedAt = requestStartTimes.get(request) ?? performance.now();
	return Math.round((performance.now() - startedAt) * 100) / 100;
}

function errorMetadataFor(request: Request): ErrorMetadata | undefined {
	return requestErrors.get(request);
}

/**
 * 把可用于排障的错误元数据提取到请求日志。
 *
 * provider 原始报文可能包含患者、费用或凭证信息，不能为了“方便排查”直接
 * 写入日志；这里只保留操作名、HTTP 状态码、请求号和重试判断。
 */
export function safeErrorMetadata(
	error: unknown,
	code: unknown,
): ErrorMetadata {
	const metadata: ErrorMetadata = {
		errorName: error instanceof Error ? error.name : "UnknownError",
		...(typeof code === "string" ? { errorCode: code } : {}),
	};
	if (error instanceof ProviderRequestError) {
		return {
			...metadata,
			...providerFailureMetadata(error),
		};
	}
	if (error instanceof PersistenceUnavailableError) {
		return {
			...metadata,
			persistenceOperation: error.operation,
			...(error.errorCode ? { persistenceErrorCode: error.errorCode } : {}),
		};
	}
	if (error instanceof DependencyNotConfiguredError) {
		return { ...metadata, dependency: error.dependency };
	}
	if (
		error instanceof PatientDirectorySnapshotResultValidationError ||
		error instanceof ExternalTraceReadModelValidationError ||
		error instanceof PaymentOrderReadModelValidationError ||
		error instanceof PaymentQuoteReadModelValidationError ||
		error instanceof SessionPrincipalReadModelValidationError
	) {
		return { ...metadata, readModelViolation: error.violation };
	}
	return metadata;
}

/**
 * API 请求日志只记录元数据，不记录 body、Authorization 或 provider 报文。
 * 具体敏感字段的最终兜底由 Pino redact 配置负责。
 */
export function requestLoggingPlugin(logger: AppLogger) {
	return (
		new Elysia({ name: "request-logging" })
			// Elysia 1.4.29 的 request hook 类型声明会把通用 on overload 推导为
			// never[]，但运行时明确接受函数；将这个兼容断言限制在适配层内。
			.on({ as: "global" }, "request", (({ request }: { request: Request }) => {
				requestStartTimes.set(request, performance.now());
			}) as never)
			// 只保留错误类型、依赖名称和 provider 低敏状态字段；不把 message、body
			// 或 provider 原始响应写入日志，避免维护便利性反过来扩大敏感数据暴露面。
			.onError({ as: "global" }, (({
				request,
				code,
				error,
			}: {
				request: Request;
				code: unknown;
				error: unknown;
			}) => {
				requestErrors.set(request, safeErrorMetadata(error, code));
			}) as never)
			// afterResponse 能看到错误处理器最终写入的状态码，避免把 503 等错误
			// 错记成异常抛出时的默认 500；它本身只做观测，不改变响应。
			.onAfterResponse({ as: "global" }, ({ request, set }) => {
				const status = statusCode(set.status);
				const errorMetadata = errorMetadataFor(request);
				const failed = status >= 400;
				const level = status >= 500 ? "error" : failed ? "warn" : "info";
				logger[level](
					{
						...requestFields(
							request,
							status,
							durationFor(request),
							failed ? "http.request.failed" : "http.request.completed",
						),
						...(errorMetadata ?? {}),
					},
					failed ? "HTTP request failed" : "HTTP request completed",
				);
			})
	);
}
