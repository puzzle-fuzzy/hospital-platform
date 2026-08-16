import { DependencyNotConfiguredError } from "@hospital/domain";

/**
 * 持久化后端在请求期间暂时不可用。
 *
 * 该错误只携带内部操作分类和原始 cause，HTTP 层必须映射成安全的
 * 503 响应；数据库账号、连接串和 MySQL 原始报文不能返回给小程序。
 */
export class PersistenceUnavailableError extends Error {
	readonly operation: "read" | "write" | "transaction";

	constructor(operation: "read" | "write" | "transaction", cause?: unknown) {
		super("Persistence backend is temporarily unavailable");
		this.name = "PersistenceUnavailableError";
		this.operation = operation;
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
