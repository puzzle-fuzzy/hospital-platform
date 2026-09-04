import { OUTPATIENT_PAY_CONFIG, STORAGE_KEYS } from "../config";

export type RequestOptions = {
	path: string;
	method?: "GET" | "POST";
	data?: Record<string, unknown>;
	query?: Record<string, unknown>;
};

export class ApiError extends Error {
	readonly statusCode: number;
	readonly payload: unknown;
	readonly code: string;
	readonly requestId: string;

	constructor(
		message: string,
		statusCode: number,
		payload?: unknown,
		requestId = "",
	) {
		super(message);
		this.name = "ApiError";
		this.statusCode = statusCode;
		this.payload = payload;
		this.code = readCode(payload);
		this.requestId = requestId;
	}
}

function buildUrl(path: string, query?: Record<string, unknown>): string {
	const url = `${OUTPATIENT_PAY_CONFIG.apiBaseUrl.replace(/\/$/, "")}/${path.replace(/^\//, "")}`;
	if (!query) return url;
	const values = Object.entries(query).filter(
		([, value]) => value !== undefined && value !== null && value !== "",
	);
	if (values.length === 0) return url;
	return `${url}?${values
		.map(
			([key, value]) =>
				`${encodeURIComponent(key)}=${encodeURIComponent(String(value))}`,
		)
		.join("&")}`;
}

function readToken(): string {
	return String(wx.getStorageSync(STORAGE_KEYS.accessToken) || "").trim();
}

function readMessage(payload: unknown): string {
	if (!payload || typeof payload !== "object") return "请求失败";
	const value = payload as Record<string, unknown>;
	const error = value.error;
	if (error && typeof error === "object" && "message" in error && error.message)
		return String(error.message);
	return String(value.message || value.msg || value.err_msg || "请求失败");
}

function readCode(payload: unknown): string {
	if (!payload || typeof payload !== "object") return "";
	const error = (payload as Record<string, unknown>).error;
	if (!error || typeof error !== "object" || Array.isArray(error)) return "";
	const code = (error as Record<string, unknown>).code;
	return typeof code === "string" && /^[a-z0-9-]{1,64}$/.test(code) ? code : "";
}

function unwrap<T>(payload: unknown, requestId: string): T {
	if (payload && typeof payload === "object") {
		const value = payload as Record<string, unknown>;
		if (value.success === false)
			throw new ApiError(readMessage(payload), 200, payload, requestId);
		if (value.data !== undefined) return value.data as T;
	}
	return payload as T;
}

function clientRequestId(): string {
	return `mopay-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function responseRequestId(
	response: WechatMiniprogram.RequestSuccessCallbackResult,
): string {
	const headers = response.header || {};
	for (const [name, value] of Object.entries(headers)) {
		if (
			name.toLowerCase() === "x-request-id" &&
			typeof value === "string" &&
			/^[A-Za-z0-9._:-]{1,128}$/.test(value)
		)
			return value;
	}
	return "";
}

/** 所有请求统一经过新版平台，并保留 request id 供服务端日志检索。 */
export function request<T>(options: RequestOptions): Promise<T> {
	return new Promise((resolve, reject) => {
		const requestId = clientRequestId();
		const requestOptions: WechatMiniprogram.RequestOption = {
			url: buildUrl(options.path, options.query),
			method: options.method || "GET",
			timeout: OUTPATIENT_PAY_CONFIG.requestTimeoutMs,
			header: {
				"Content-Type": "application/json",
				"X-Request-Id": requestId,
				...(readToken() ? { Authorization: `Bearer ${readToken()}` } : {}),
			},
			success: (response) => {
				const resolvedRequestId = responseRequestId(response) || requestId;
				if (response.statusCode < 200 || response.statusCode >= 300) {
					reject(
						new ApiError(
							readMessage(response.data),
							response.statusCode,
							response.data,
							resolvedRequestId,
						),
					);
					return;
				}
				try {
					resolve(unwrap<T>(response.data, resolvedRequestId));
				} catch (error) {
					reject(error);
				}
			},
			fail: (error) =>
				reject(
					new ApiError(error.errMsg || "网络请求失败", 0, error, requestId),
				),
		};
		if (options.data) requestOptions.data = options.data;
		wx.request(requestOptions);
	});
}

export function asRecord(value: unknown): Record<string, unknown> {
	return value && typeof value === "object" && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: {};
}
