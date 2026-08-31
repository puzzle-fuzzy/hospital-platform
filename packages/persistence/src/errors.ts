import { DependencyNotConfiguredError } from "@hospital/domain";

/**
 * 允许写入持久化诊断日志的瞬态连接/传输错误码。
 *
 * 这里不能直接把任意 `error.code` 写入日志：数据库驱动或第三方库可能把
 * SQL、连接信息或业务字段拼进自定义 code。只有明确属于连接恢复边界的
 * 固定错误码，才允许作为低敏诊断字段向上层暴露。
 */
/**
 * 允许进入日志的瞬态错误码及其规范化形式。
 *
 * mysql2 通常返回大写下划线形式，但 Redis、HTTP 包装层或旧兼容层可能
 * 把同一个故障写成小写短横线形式（例如 `protocol-connection-lost`）。
 * 业务层只接受这里的固定集合，并统一输出大写下划线形式；不能直接把
 * 驱动返回的任意字符串原样写入日志。
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
 * 将驱动/包装层的错误码收窄为固定的低敏诊断码。
 *
 * 只做大小写、短横线和下划线的格式兼容，不做模糊包含匹配；例如带有
 * 连接串、主机名或 SQL 片段的自定义 code 即使包含某个关键词，也必须被
 * 丢弃。返回值同时被瞬态判断和结构化日志复用，保证“允许重试判断”和
 * “日志显示结果”不会产生两套不一致的规则。
 */
function normalizedTransientPersistenceErrorCode(
	code: string | undefined,
): string | undefined {
	if (!code) return undefined;
	const normalized = code.trim().toUpperCase().replaceAll("-", "_");
	return TRANSIENT_PERSISTENCE_ERROR_CODES.has(normalized)
		? normalized
		: undefined;
}

/**
 * 判断错误是否属于可以进入只读恢复边界的连接/传输故障。
 *
 * 该函数只用于识别错误，不代表任何业务写入可以自动重放；写入是否允许
 * 重试仍必须由具体业务的不变式和持久化事实单独证明。
 */
export function isTransientPersistenceError(error: unknown): boolean {
	return (
		normalizedTransientPersistenceErrorCode(errorCodeOf(error)) !== undefined
	);
}

/**
 * 从原始错误或嵌套 cause 中提取允许记录的持久化错误码。
 * 原始错误对象仍保留在 `cause` 上供服务端内部处理，但不会进入 HTTP 响应
 * 或结构化日志，避免连接串、SQL 和参数泄露。
 */
export function safePersistenceErrorCode(error: unknown): string | undefined {
	let current: unknown = error;
	for (let depth = 0; depth < 3; depth += 1) {
		const normalizedCode = normalizedTransientPersistenceErrorCode(
			errorCodeOf(current),
		);
		if (normalizedCode) return normalizedCode;
		if (typeof current !== "object" || current === null) return undefined;
		current = (current as { cause?: unknown }).cause;
	}
	return undefined;
}

/**
 * 持久化故障的后端来源。
 *
 * 这里只允许记录平台已知的固定枚举，不能把驱动连接串、主机名或 Redis
 * 键名作为“依赖名称”传入日志。这样线上出现 `read + ETIMEDOUT` 时，维护
 * 人员可以继续区分 MySQL 与 Redis，而不会扩大敏感信息暴露面。
 */
export type PersistenceDependency = "mysql" | "redis";

/** 运行时重新收窄依赖来源，防止 JavaScript 调用方绕过 TypeScript 类型。 */
function normalizePersistenceDependency(
	value: unknown,
): PersistenceDependency | undefined {
	return value === "mysql" || value === "redis" ? value : undefined;
}

/**
 * 持久化后端在请求期间暂时不可用。
 *
 * 该错误只携带内部操作分类和原始 cause，HTTP 层必须映射成安全的
 * 503 响应；数据库账号、连接串和 MySQL 原始报文不能返回给小程序。
 */
export class PersistenceUnavailableError extends Error {
	readonly operation: "read" | "write" | "transaction";
	/** 产生本次故障的固定后端来源；未知来源时保持 undefined。 */
	readonly dependency: PersistenceDependency | undefined;
	/** 仅允许记录的连接/传输层错误码，不包含原始错误消息。 */
	readonly errorCode: string | undefined;

	constructor(
		operation: "read" | "write" | "transaction",
		cause?: unknown,
		dependency?: PersistenceDependency,
	) {
		super("Persistence backend is temporarily unavailable");
		this.name = "PersistenceUnavailableError";
		this.operation = operation;
		this.dependency = normalizePersistenceDependency(dependency);
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
		| "manual-review"
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
			| "manual-review"
			| "health-knowledge",
	) {
		super(`persistence:${resource}`);
		this.name = "PersistenceNotConfiguredError";
		this.resource = resource;
	}
}
