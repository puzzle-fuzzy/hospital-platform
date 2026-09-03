import { PAY_CONFIG, STORAGE_KEYS } from "../config";

export type RequestOptions = {
	path: string;
	method?: "GET" | "POST";
	data?: Record<string, unknown>;
	query?: Record<string, unknown>;
	contentType?: string;
	idempotencyKey?: string;
};

export class ApiError extends Error {
	readonly statusCode: number;
	readonly payload: unknown;

	constructor(message: string, statusCode: number, payload?: unknown) {
		super(message);
		this.name = "ApiError";
		this.statusCode = statusCode;
		this.payload = payload;
	}
}

function buildUrl(path: string, query?: Record<string, unknown>): string {
	const url = `${PAY_CONFIG.apiBaseUrl.replace(/\/$/, "")}/${path.replace(/^\//, "")}`;
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

function unwrap<T>(payload: unknown): T {
	if (payload && typeof payload === "object") {
		const value = payload as Record<string, unknown>;
		if (value.success === false)
			throw new ApiError(readMessage(payload), 200, payload);
		if (value.data !== undefined) return value.data as T;
	}
	return payload as T;
}

function requestId(): string {
	return `mpay-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

/** 所有小程序网络请求都经过新版平台 API，provider 凭证永不进入页面代码。 */
export function request<T>(options: RequestOptions): Promise<T> {
	const token = readToken();
	return new Promise((resolve, reject) => {
		const requestOptions: WechatMiniprogram.RequestOption = {
			url: buildUrl(options.path, options.query),
			method: options.method || "GET",
			timeout: PAY_CONFIG.requestTimeoutMs,
			header: {
				"Content-Type": options.contentType || "application/json",
				"X-Request-Id": requestId(),
				...(options.idempotencyKey
					? { "Idempotency-Key": options.idempotencyKey }
					: {}),
				...(token ? { Authorization: `Bearer ${token}` } : {}),
			},
			success: (response) => {
				if (response.statusCode < 200 || response.statusCode >= 300) {
					reject(
						new ApiError(
							readMessage(response.data),
							response.statusCode,
							response.data,
						),
					);
					return;
				}
				try {
					resolve(unwrap<T>(response.data));
				} catch (error) {
					reject(error);
				}
			},
			fail: (error) =>
				reject(new ApiError(error.errMsg || "网络请求失败", 0, error)),
		};
		if (options.data) requestOptions.data = options.data;
		wx.request(requestOptions);
	});
}

export function newIdempotencyKey(prefix: string): string {
	return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

export function asRecord(value: unknown): Record<string, unknown> {
	return value && typeof value === "object" && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: {};
}

export function asList<T>(value: unknown): T[] {
	if (Array.isArray(value)) return value as T[];
	const record = asRecord(value);
	for (const key of ["items", "list", "records", "rows"])
		if (Array.isArray(record[key])) return record[key] as T[];
	return [];
}
