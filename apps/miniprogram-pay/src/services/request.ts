import { PAY_CONFIG, STORAGE_KEYS } from "../config";

export type RequestOptions = {
	baseUrl: string;
	path: string;
	method?: "GET" | "POST";
	data?: Record<string, unknown>;
	query?: Record<string, unknown>;
	contentType?: string;
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

function buildUrl(
	baseUrl: string,
	path: string,
	query?: Record<string, unknown>,
): string {
	const url = `${baseUrl.replace(/\/$/, "")}/${path.replace(/^\//, "")}`;
	if (!query) return url;
	const values = Object.entries(query).filter(
		([, value]) => value !== undefined && value !== null && value !== "",
	);
	if (values.length === 0) return url;
	const suffix = values
		.map(
			([key, value]) =>
				`${encodeURIComponent(key)}=${encodeURIComponent(String(value))}`,
		)
		.join("&");
	return `${url}?${suffix}`;
}

function readToken(): string {
	return String(wx.getStorageSync(STORAGE_KEYS.accessToken) || "").trim();
}

function readMessage(payload: unknown): string {
	if (!payload || typeof payload !== "object") return "请求失败";
	const value = payload as Record<string, unknown>;
	return String(
		value.message || value.msg || value.error || value.err_msg || "请求失败",
	);
}

function unwrap<T>(payload: unknown): T {
	if (payload && typeof payload === "object") {
		const value = payload as Record<string, unknown>;
		if (value.success === false || String(value.code || "") === "5") {
			throw new ApiError(readMessage(payload), 200, payload);
		}
		if (value.data !== undefined) return value.data as T;
	}
	return payload as T;
}

export function request<T>(options: RequestOptions): Promise<T> {
	const token = readToken();
	return new Promise((resolve, reject) => {
		const requestOptions: WechatMiniprogram.RequestOption = {
			url: buildUrl(options.baseUrl, options.path, options.query),
			method: options.method || "GET",
			timeout: PAY_CONFIG.requestTimeoutMs,
			header: {
				...(options.contentType ? { "Content-Type": options.contentType } : {}),
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

export const providerRequest = <T>(options: Omit<RequestOptions, "baseUrl">) =>
	request<T>({ ...options, baseUrl: PAY_CONFIG.providerBaseUrl });

export const platformRequest = <T>(options: Omit<RequestOptions, "baseUrl">) =>
	request<T>({ ...options, baseUrl: PAY_CONFIG.platformBaseUrl });

export function asList<T>(value: unknown): T[] {
	if (Array.isArray(value)) return value as T[];
	if (!value || typeof value !== "object") return [];
	const record = value as Record<string, unknown>;
	for (const key of ["list", "records", "rows", "items", "result"]) {
		if (Array.isArray(record[key])) return record[key] as T[];
	}
	return [];
}

export function asRecord(value: unknown): Record<string, any> {
	return value && typeof value === "object"
		? (value as Record<string, any>)
		: {};
}
