import { Elysia } from "elysia";

const requestIdPattern = /^[A-Za-z0-9._:-]{1,128}$/;

/** 只接受可安全进入日志和响应头的 request id；不信任客户端任意注入换行符。 */
function requestIdFrom(request: Request): string {
	const incoming = request.headers.get("x-request-id")?.trim();
	return incoming && requestIdPattern.test(incoming)
		? incoming
		: crypto.randomUUID();
}

/** 从 Elysia headers 生成 provider 调用上下文，避免业务模块依赖隐式全局状态。 */
export function adapterContextFromHeaders(
	headers: Record<string, string | undefined>,
): { traceId: string; idempotencyKey: string } {
	const incomingTraceId = headers["x-request-id"]?.trim();
	const traceId =
		incomingTraceId && requestIdPattern.test(incomingTraceId)
			? incomingTraceId
			: crypto.randomUUID();
	const incomingIdempotencyKey = headers["idempotency-key"]?.trim();
	const idempotencyKey =
		incomingIdempotencyKey && requestIdPattern.test(incomingIdempotencyKey)
			? incomingIdempotencyKey
			: traceId;
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
