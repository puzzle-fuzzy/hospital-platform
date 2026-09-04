import { ProviderRequestError } from "@hospital/adapters";
import {
	AppointmentDirectoryResultValidationError,
	AppointmentRecordResultValidationError,
	DependencyNotConfiguredError,
	ExternalTraceReadModelValidationError,
	HealthKnowledgeResultValidationError,
	IdentityUserReadModelValidationError,
	OutpatientPaymentResultValidationError,
	PatientDirectoryGeneratedIdValidationError,
	PatientDirectoryResultValidationError,
	PatientDirectorySnapshotResultValidationError,
	PatientReadModelValidationError,
	PaymentOrderReadModelValidationError,
	PaymentQuoteReadModelValidationError,
	ReportResultValidationError,
	UserProfileReadModelValidationError,
	WechatIdentityResultValidationError,
} from "@hospital/domain";
import {
	type AppLogger,
	type ProviderTransportErrorCode,
	providerFailureMetadata,
} from "@hospital/observability";
import { PersistenceUnavailableError } from "@hospital/persistence";
import { Elysia } from "elysia";
import { HttpError } from "../errors";
import { SessionPrincipalReadModelValidationError } from "../modules/auth/service";
import { requestOwner } from "./request-context";

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
	providerFailureStage?: "transport" | "http" | "response";
	providerFailureReason?: "appointment-source-unavailable";
	/** 只记录 observability 包登记过的 TLS/DNS/连接错误码。 */
	providerTransportErrorCode?: ProviderTransportErrorCode;
	/** 持久化内部操作分类，不包含 SQL、连接串或原始错误消息。 */
	persistenceOperation?: PersistenceUnavailableError["operation"];
	/** 仅允许列表中的连接/传输层错误码。 */
	persistenceErrorCode?: string;
	/** 持久化后端的固定来源，不记录连接地址或驱动细节。 */
	persistenceDependency?: PersistenceUnavailableError["dependency"];
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
	const ownerUserId = requestOwner(request);
	return {
		event,
		requestId,
		traceId: requestId,
		...(ownerUserId ? { ownerUserId } : {}),
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
 * 将已知错误投影成最终对外错误码。
 *
 * Elysia 的 `onError` 生命周期会把部分业务异常报告成 `UNKNOWN`，但统一
 * 错误处理器随后仍会把它们映射成稳定的 HTTP 错误码。请求日志如果只保存
 * 生命周期的 code，线上就只能看到 `errorCode=UNKNOWN`，无法直接按
 * `unauthorized` 或 `provider-temporarily-unavailable` 检索。这里仅覆盖
 * 已有稳定映射的两类高频边界，不读取 message、请求体或 Provider 原文，
 * 也不改变客户端收到的响应。
 */
function publicErrorCode(error: unknown): string | undefined {
	if (error instanceof HttpError) return error.code;
	if (error instanceof ProviderRequestError) {
		if (error.reason === "appointment-source-unavailable")
			return "appointment-source-unavailable";
		if (error.responseInvalid) return "provider-response-invalid";
		return error.retryable
			? "provider-temporarily-unavailable"
			: "provider-request-rejected";
	}
	if (error instanceof PersistenceUnavailableError) {
		return "persistence-temporarily-unavailable";
	}
	if (error instanceof DependencyNotConfiguredError) {
		return "dependency-not-configured";
	}
	return undefined;
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
	const resolvedErrorCode =
		publicErrorCode(error) ?? (typeof code === "string" ? code : undefined);
	const metadata: ErrorMetadata = {
		errorName: error instanceof Error ? error.name : "UnknownError",
		...(resolvedErrorCode ? { errorCode: resolvedErrorCode } : {}),
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
			...(error.dependency ? { persistenceDependency: error.dependency } : {}),
			...(error.errorCode ? { persistenceErrorCode: error.errorCode } : {}),
		};
	}
	if (error instanceof DependencyNotConfiguredError) {
		return { ...metadata, dependency: error.dependency };
	}
	if (
		error instanceof AppointmentDirectoryResultValidationError ||
		error instanceof AppointmentRecordResultValidationError ||
		error instanceof PatientDirectorySnapshotResultValidationError ||
		error instanceof PatientDirectoryGeneratedIdValidationError ||
		error instanceof PatientDirectoryResultValidationError ||
		error instanceof PatientReadModelValidationError ||
		error instanceof ExternalTraceReadModelValidationError ||
		error instanceof HealthKnowledgeResultValidationError ||
		error instanceof IdentityUserReadModelValidationError ||
		error instanceof OutpatientPaymentResultValidationError ||
		error instanceof PaymentOrderReadModelValidationError ||
		error instanceof PaymentQuoteReadModelValidationError ||
		error instanceof ReportResultValidationError ||
		error instanceof SessionPrincipalReadModelValidationError ||
		error instanceof UserProfileReadModelValidationError ||
		error instanceof WechatIdentityResultValidationError
	) {
		// 这些错误都携带固定的 domain violation；把它投影到 HTTP 失败事件，
		// 让请求日志和业务 service 日志可以用同一个 trace 解释“为什么失败”。
		// violation 来自有限枚举，不记录字段原值、患者资料或 Provider 报文。
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
