import { DependencyNotConfiguredError } from "@hospital/domain";

/**
 * 允许写入持久化诊断日志的瞬态连接/传输错误码。
 *
 * 这里不能直接把任意 `error.code` 写入日志：数据库驱动或第三方库可能把
 * SQL、连接信息或业务字段拼进自定义 code。只有明确属于连接恢复边界的
 * 固定错误码，才允许作为低敏诊断字段向上层暴露。
 */
const TRANSIENT_PERSISTENCE_ERROR_CODES = new Set([
	"PROTOCOL_CONNECTION_LOST",
	"ECONNRESET",
	"ECONNREFUSED",
	"ETIMEDOUT",
	"EPIPE",
	"ENETUNREACH",
	"EHOSTUNREACH",
]);

function errorCodeOf(error: unknown): string | undefined {
	if (typeof error !== "object" || error === null) return undefined;
	const code = (error as { code?: unknown }).code;
	return typeof code === "string" ? code : undefined;
}

/**
 * 判断错误是否属于可以进入只读恢复边界的连接/传输故障。
 *
 * 该函数只用于识别错误，不代表任何业务写入可以自动重放；写入是否允许
 * 重试仍必须由具体业务的不变式和持久化事实单独证明。
 */
export function isTransientPersistenceError(error: unknown): boolean {
	const code = errorCodeOf(error);
	return code !== undefined && TRANSIENT_PERSISTENCE_ERROR_CODES.has(code);
}

/**
 * 从原始错误或嵌套 cause 中提取允许记录的持久化错误码。
 * 原始错误对象仍保留在 `cause` 上供服务端内部处理，但不会进入 HTTP 响应
 * 或结构化日志，避免连接串、SQL 和参数泄露。
 */
export function safePersistenceErrorCode(error: unknown): string | undefined {
	let current: unknown = error;
	for (let depth = 0; depth < 3; depth += 1) {
		if (isTransientPersistenceError(current)) return errorCodeOf(current);
		if (typeof current !== "object" || current === null) return undefined;
		current = (current as { cause?: unknown }).cause;
	}
	return undefined;
}

/**
 * 持久化后端在请求期间暂时不可用。
 *
 * 该错误只携带内部操作分类和原始 cause，HTTP 层必须映射成安全的
 * 503 响应；数据库账号、连接串和 MySQL 原始报文不能返回给小程序。
 */
export class PersistenceUnavailableError extends Error {
	readonly operation: "read" | "write" | "transaction";
	/** 仅允许记录的连接/传输层错误码，不包含原始错误消息。 */
	readonly errorCode: string | undefined;

	constructor(operation: "read" | "write" | "transaction", cause?: unknown) {
		super("Persistence backend is temporarily unavailable");
		this.name = "PersistenceUnavailableError";
		this.operation = operation;
		this.errorCode = safePersistenceErrorCode(cause);
		this.cause = cause;
	}
}

export class PersistenceNotConfiguredError extends DependencyNotConfiguredError {
	readonly resource:
		| "identity-users"
		| "user-profiles"
		| "patients"
		| "payment-orders"
		| "payment-quotes"
		| "payment-prepay-attempts"
		| "wechat-payment-notifications"
		| "appointment-schedule-snapshots"
		| "report-references"
		| "health-knowledge";

	constructor(
		resource:
			| "identity-users"
			| "user-profiles"
			| "patients"
			| "payment-orders"
			| "payment-quotes"
			| "payment-prepay-attempts"
			| "wechat-payment-notifications"
			| "appointment-schedule-snapshots"
			| "report-references"
			| "health-knowledge",
	) {
		super(`persistence:${resource}`);
		this.name = "PersistenceNotConfiguredError";
		this.resource = resource;
	}
}
