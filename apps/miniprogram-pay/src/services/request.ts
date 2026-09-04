import { PAY_CONFIG, STORAGE_KEYS } from "../config";

export type RequestOptions = {
	path: string;
	method?: "GET" | "POST";
	data?: Record<string, unknown>;
	query?: Record<string, unknown>;
	contentType?: string;
	idempotencyKey?: string;
};

type SessionRecovery = () => Promise<unknown>;

/**
 * 由 session 模块注册重新登录动作，避免 request.ts 与 session.ts 互相 import。
 * 认证恢复只在受保护请求收到 401 时触发，登录接口本身不会递归触发恢复。
 */
let sessionRecovery: SessionRecovery | undefined;
let sessionRecoveryInFlight: Promise<unknown> | undefined;

export class ApiError extends Error {
	readonly statusCode: number;
	readonly payload: unknown;
	/** 服务端稳定错误码；小程序业务分支只能按字符串码判断。 */
	readonly code: string;
	/** 服务端返回的低敏 request id，供测试人员反查 API 日志；不展示给普通用户。 */
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

function requestId(): string {
	return `mpay-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function responseRequestId(
	response: WechatMiniprogram.RequestSuccessCallbackResult,
): string {
	const headers = response.header || {};
	const pattern = /^[A-Za-z0-9._:-]{1,128}$/;
	for (const [name, value] of Object.entries(headers)) {
		if (
			name.toLowerCase() === "x-request-id" &&
			typeof value === "string" &&
			pattern.test(value)
		) {
			return value;
		}
	}
	return "";
}

/** 供 session.ts 注册单飞的重新登录动作。 */
export function registerSessionRecovery(recovery: SessionRecovery): void {
	sessionRecovery = recovery;
}

function isWechatLoginRequest(options: RequestOptions): boolean {
	return options.path.replace(/^\/+/, "") === "auth/wechat";
}

/**
 * 只执行一次真实的微信登录请求。
 *
 * 业务请求不在这里重试；这里保留“单次原请求”的边界，避免占号、预约写入
 * 或支付命令因为网络/服务端响应异常被盲目重放。只有明确的 401 会话失效才
 * 允许重新建立会话，然后把原请求再执行一次。
 */
function requestOnce<T>(options: RequestOptions): Promise<T> {
	const token = readToken();
	return new Promise((resolve, reject) => {
		const clientRequestId = requestId();
		const requestOptions: WechatMiniprogram.RequestOption = {
			url: buildUrl(options.path, options.query),
			method: options.method || "GET",
			timeout: PAY_CONFIG.requestTimeoutMs,
			header: {
				"Content-Type": options.contentType || "application/json",
				"X-Request-Id": clientRequestId,
				...(options.idempotencyKey
					? { "Idempotency-Key": options.idempotencyKey }
					: {}),
				...(token ? { Authorization: `Bearer ${token}` } : {}),
			},
			success: (response) => {
				if (response.statusCode < 200 || response.statusCode >= 300) {
					const resolvedRequestId =
						responseRequestId(response) || clientRequestId;
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
					resolve(
						unwrap<T>(
							response.data,
							responseRequestId(response) || clientRequestId,
						),
					);
				} catch (error) {
					reject(error);
				}
			},
			fail: (error) =>
				reject(
					new ApiError(
						error.errMsg || "网络请求失败",
						0,
						error,
						clientRequestId,
					),
				),
		};
		if (options.data) requestOptions.data = options.data;
		wx.request(requestOptions);
	});
}

/**
 * 所有小程序网络请求都经过新版平台 API，provider 凭证永不进入页面代码。
 *
 * 体验版可能长时间保留在后台，Redis 会话 TTL 到期后页面再次展示时仍会带
 * 旧 token。收到服务端 401 时清除旧会话、单飞重新登录，并仅重放当前一次
 * 请求，避免用户必须手动清理小程序缓存；第二次仍失败则原样交给页面处理。
 */
export async function request<T>(options: RequestOptions): Promise<T> {
	try {
		return await requestOnce<T>(options);
	} catch (error) {
		if (
			!(error instanceof ApiError) ||
			error.statusCode !== 401 ||
			isWechatLoginRequest(options) ||
			!sessionRecovery
		)
			throw error;

		if (!sessionRecoveryInFlight) {
			const recovery = sessionRecovery;
			sessionRecoveryInFlight = Promise.resolve()
				.then(() => recovery())
				.finally(() => {
					sessionRecoveryInFlight = undefined;
				});
		}
		await sessionRecoveryInFlight;
		return requestOnce<T>(options);
	}
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
