import { Elysia } from "elysia";
import type { AppLogger } from "@hospital/observability";

const requestStartTimes = new WeakMap<Request, number>();

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
	event = status >= 500 ? "http.request.failed" : "http.request.completed",
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
			// afterResponse 能看到错误处理器最终写入的状态码，避免把 503 等错误
			// 错记成异常抛出时的默认 500；它本身只做观测，不改变响应。
			.onAfterResponse({ as: "global" }, ({ request, set }) => {
				const status = statusCode(set.status);
				logger[status >= 500 ? "error" : "info"](
					{
						...requestFields(
							request,
							status,
							durationFor(request),
							status >= 500 ? "http.request.failed" : "http.request.completed",
						),
					},
					status >= 500 ? "HTTP request failed" : "HTTP request completed",
				);
			})
	);
}
