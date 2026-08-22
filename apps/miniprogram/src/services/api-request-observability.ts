import type { ApiMethod } from "../types";

/**
 * 小程序客户端请求的安全观测结果。
 *
 * 这里只保存链路元数据，不保存 URL 查询串、请求体、Authorization、患者 ID
 * 或 Provider 原始响应。`requestId` 可以和服务端 Pino 的 `requestId/traceId`
 * 对齐，`path` 只保留不带查询参数的内部路径，供真机成功链路取证使用。
 */
export type ApiRequestObservation = Readonly<{
	requestId: string;
	method: ApiMethod;
	path: string;
	statusCode: number;
	durationMs: number;
	outcome: "success" | "http-error" | "network-error";
	errorCode?: string;
}>;

/** 防止长时间打开小程序后请求观测无限增长；取证只需要最近一小段链路。 */
export const MAX_RECENT_API_REQUEST_OBSERVATIONS = 64;

const recentObservations: ApiRequestObservation[] = [];

/**
 * 观测日志只允许记录内部路径，不允许把 query 中的患者/账单参数带入控制台。
 * 非内部路径统一折叠为 `/unknown`，避免未来 direct-call 把完整 URL 写入日志。
 */
export function sanitizeApiRequestPath(value: string): string {
	const path = value.split(/[?#]/u, 1)[0] ?? "";
	if (!path.startsWith("/") || path.length > 256) return "/unknown";
	return path || "/unknown";
}

/**
 * 记录一次已完成的 HTTP 观测。
 *
 * 控制台输出是开发者工具/真机调试的可见证据，内存快照则给验收脚本或
 * 页面调试入口使用。日志写入失败不能影响业务请求的 resolve/reject 结果，
 * 因此这里对控制台调用做隔离保护。
 */
export function recordApiRequestObservation(
	observation: ApiRequestObservation,
): void {
	const safeObservation = Object.freeze({
		...observation,
		path: sanitizeApiRequestPath(observation.path),
	});
	recentObservations.push(safeObservation);
	if (recentObservations.length > MAX_RECENT_API_REQUEST_OBSERVATIONS) {
		recentObservations.splice(
			0,
			recentObservations.length - MAX_RECENT_API_REQUEST_OBSERVATIONS,
		);
	}

	try {
		// 只输出上述低敏字段；这不是业务日志发送器，不会向服务端上传任何数据。
		console.info("[hospital-api.request]", safeObservation);
	} catch {
		// 某些真机调试容器可能禁用 console；观测失败不能改变请求结果。
	}
}

/** 返回副本，避免调用方修改内部观测顺序或覆盖已记录的 requestId。 */
export function getRecentApiRequestObservations(): ApiRequestObservation[] {
	return [...recentObservations];
}

/** 测试和重新开始一轮人工取证时清理旧链路，避免新旧账号观测混在一起。 */
export function clearApiRequestObservations(): void {
	recentObservations.length = 0;
}
