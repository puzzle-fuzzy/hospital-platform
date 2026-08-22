import { Elysia } from "elysia";

/**
 * 请求关联号和幂等键共用的安全形状：只允许有限 ASCII 字符，避免控制字符、
 * 空白或超长值进入响应头、日志字段和 Provider 调用上下文。
 */
const requestIdPattern = /^[A-Za-z0-9._:-]{1,128}$/;

/**
 * 归一化调用方提供的关联值；非法值返回 undefined，由调用边界生成新的安全值。
 * 不能把非法值直接当作“缺省值”继续向下传递，否则日志链和幂等链会被污染。
 */
function normalizedHeaderValue(
	value: string | null | undefined,
): string | undefined {
	const candidate = value?.trim();
	return candidate && requestIdPattern.test(candidate) ? candidate : undefined;
}

/** 只接受可安全进入日志和响应头的 request id；不信任客户端任意注入换行符。 */
function requestIdFrom(request: Request): string {
	return (
		normalizedHeaderValue(request.headers.get("x-request-id")) ??
		crypto.randomUUID()
	);
}

/** 从 Elysia headers 生成 provider 调用上下文，避免业务模块依赖隐式全局状态。 */
export function adapterContextFromHeaders(
	headers: Record<string, string | undefined>,
): { traceId: string; idempotencyKey: string } {
	const traceId =
		normalizedHeaderValue(headers["x-request-id"]) ?? crypto.randomUUID();
	const idempotencyKey =
		normalizedHeaderValue(headers["idempotency-key"]) ?? traceId;
	return { traceId, idempotencyKey };
}

export function requestContextPlugin() {
	return new Elysia({ name: "request-context" }).onRequest(
		({ request, set }) => {
			const traceId = requestIdFrom(request);
			request.headers.set("x-request-id", traceId);
			set.headers["x-request-id"] = traceId;
		},
	);
}
