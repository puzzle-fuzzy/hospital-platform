import { isBoundedOpaqueIdentifier } from "./opaque-identifier";
import type { ExternalTrace } from "./ports";

/** Provider trace 只允许进入日志和内部关联，不得携带原始响应或敏感凭证。 */
export type ExternalTraceReadModelViolation =
	| "trace-not-object"
	| "provider-invalid"
	| "provider-mismatch"
	| "operation-invalid"
	| "request-id-invalid"
	| "provider-order-id-invalid";

/** 可替换 gateway 返回异常 trace 时的固定低敏错误。 */
export class ExternalTraceReadModelValidationError extends Error {
	readonly violation: ExternalTraceReadModelViolation;

	constructor(violation: ExternalTraceReadModelViolation) {
		super("External trace read model is invalid");
		this.name = "ExternalTraceReadModelValidationError";
		this.violation = violation;
	}
}

/**
 * 校验并重新投影 gateway trace。
 *
 * adapter 会生成第一版 trace，但 gateway 仍是可替换的运行时端口；回放任务、
 * 测试 fixture 或错误实现不能因为声明了 `ExternalTrace` 类型，就把任意字符串
 * 写进 Pino 或短期引用。未知字段全部丢弃，必要时还确认 Provider 归属。
 */
export function normalizeExternalTrace(
	value: unknown,
	options: { expectedProvider?: string } = {},
): ExternalTrace {
	if (typeof value !== "object" || value === null || Array.isArray(value)) {
		throw new ExternalTraceReadModelValidationError("trace-not-object");
	}

	const trace = value as Record<string, unknown>;
	if (!isBoundedOpaqueIdentifier(trace.provider)) {
		throw new ExternalTraceReadModelValidationError("provider-invalid");
	}
	if (
		options.expectedProvider !== undefined &&
		trace.provider !== options.expectedProvider
	) {
		throw new ExternalTraceReadModelValidationError("provider-mismatch");
	}
	if (!isBoundedOpaqueIdentifier(trace.operation)) {
		throw new ExternalTraceReadModelValidationError("operation-invalid");
	}
	if (!isBoundedOpaqueIdentifier(trace.requestId)) {
		throw new ExternalTraceReadModelValidationError("request-id-invalid");
	}
	if (
		trace.providerOrderId !== undefined &&
		!isBoundedOpaqueIdentifier(trace.providerOrderId)
	) {
		throw new ExternalTraceReadModelValidationError(
			"provider-order-id-invalid",
		);
	}

	return {
		provider: trace.provider,
		operation: trace.operation,
		requestId: trace.requestId,
		...(trace.providerOrderId !== undefined
			? { providerOrderId: trace.providerOrderId }
			: {}),
	};
}
