import type { ApiMethod } from "../types";
import {
	isVerboseClientTelemetry,
	recordClientTelemetrySilentEvent,
	redactClientValue,
} from "./telemetry";
import { resolveErrorNumericCode } from "./error-registry";

/**
 * 小程序客户端请求的安全观测结果。
 *
 * 这里只保存链路元数据，不保存 URL 查询串、Authorization、患者 ID
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
	/** 平台 API 封套的安全摘要；成功与失败响应都会尽量提取。 */
	envelope?: ApiRequestEnvelopeSummary;
	/**
	 * 仅 develop/trial 控制台输出的脱敏请求/响应正文摘要。
	 * release 版不记录任何正文，也不上报实时日志。
	 */
	requestPreview?: unknown;
	responsePreview?: unknown;
}>;

/**
 * 平台 API 响应封套 `{ success, data }` / `{ error: { code, message } }` 的
 * 固定摘要。字段全部由本仓库服务端契约产生，属于任何环境都可保留的低敏
 * 诊断事实：成功与否、业务错误码、服务端文案和数据形状。
 */
export type ApiRequestEnvelopeSummary = Readonly<{
	success?: boolean;
	errorCode?: string;
	message?: string;
	dataType?: "object" | "array" | "empty";
	itemCount?: number;
	total?: number;
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

const MAX_ENVELOPE_MESSAGE_LENGTH = 120;

function summarizeResponseEnvelope(
	responseData: unknown,
): ApiRequestEnvelopeSummary | undefined {
	if (typeof responseData !== "object" || responseData === null)
		return undefined;
	const record = responseData as Record<string, unknown>;
	if (record.success === true) {
		const data = record.data;
		if (data === undefined || data === null) {
			return { success: true, dataType: "empty" };
		}
		if (Array.isArray(data)) {
			return { success: true, dataType: "array", itemCount: data.length };
		}
		if (typeof data === "object") {
			const items = (data as Record<string, unknown>).items;
			const total = (data as Record<string, unknown>).total;
			return {
				success: true,
				dataType: "object",
				...(Array.isArray(items) ? { itemCount: items.length } : {}),
				...(typeof total === "number" ? { total } : {}),
			};
		}
		return { success: true, dataType: "object" };
	}
	if (
		typeof record.error === "object" &&
		record.error !== null &&
		typeof (record.error as Record<string, unknown>).code === "string"
	) {
		const error = record.error as { code: string; message?: unknown };
		return {
			errorCode: error.code.slice(0, 64),
			...(typeof error.message === "string" && error.message.length > 0
				? { message: error.message.slice(0, MAX_ENVELOPE_MESSAGE_LENGTH) }
				: {}),
		};
	}
	return undefined;
}

/**
 * 记录一次已完成的 HTTP 观测。
 *
 * 控制台输出是开发者工具/真机调试的可见证据，内存快照则给验收脚本或
 * 页面调试入口使用。日志写入失败不能影响业务请求的 resolve/reject 结果，
 * 因此这里对控制台调用做隔离保护。
 *
 * `payload` 是本次中转的请求/响应正文。develop/trial 会经过
 * `redactClientValue` 投影后附在观测里（凭证键名整值替换、深度/长度封顶）；
 * release 版只保留封套摘要，正文不进控制台、环形缓冲和实时日志。
 */
export function recordApiRequestObservation(
	observation: ApiRequestObservation,
	payload?: Readonly<{ requestData?: unknown; responseData?: unknown }>,
): void {
	const envelope =
		payload?.responseData === undefined
			? undefined
			: summarizeResponseEnvelope(payload.responseData);
	const verbose = isVerboseClientTelemetry();
	const safeObservation = Object.freeze({
		...observation,
		path: sanitizeApiRequestPath(observation.path),
		...(envelope === undefined ? {} : { envelope }),
		...(verbose && payload?.requestData !== undefined
			? { requestPreview: redactClientValue(payload.requestData) }
			: {}),
		...(verbose && payload?.responseData !== undefined
			? { responsePreview: redactClientValue(payload.responseData) }
			: {}),
	}) as ApiRequestObservation;
	recentObservations.push(safeObservation);
	if (recentObservations.length > MAX_RECENT_API_REQUEST_OBSERVATIONS) {
		recentObservations.splice(
			0,
			recentObservations.length - MAX_RECENT_API_REQUEST_OBSERVATIONS,
		);
	}

	// 同步进入统一遥测事件流（实时日志 + 全局事件环）；控制台已有带前缀的
	// 完整观测行，这里选择静默记录避免双行输出。
	recordClientTelemetrySilentEvent({
		kind: "api.request",
		method: observation.method,
		target: safeObservation.path,
		...(observation.outcome === "success" ? {} : { outcome: "failed" }),
		...(observation.errorCode === undefined
			? {}
			: { errorName: observation.errorCode }),
		fields: {
			statusCode: observation.statusCode,
			durationMs: observation.durationMs,
			result: observation.outcome,
			// 失败时数字码进 fields.errorCode，实时日志可按它过滤；
			// 字符串码保留在 errorName，便于直接 grep 源码。
			...(observation.outcome === "success"
				? {}
				: { errorCode: resolveErrorNumericCode(observation.errorCode) }),
			...(envelope?.itemCount === undefined
				? {}
				: { itemCount: envelope.itemCount }),
			...(envelope?.errorCode === undefined
				? {}
				: { errorKey: envelope.errorCode }),
		},
	});

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
