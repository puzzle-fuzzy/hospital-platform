import type {
	ApiRequestOptions,
	AppointmentDepartmentListResponse,
	AppointmentRecordListResponse,
	AppointmentScheduleListResponse,
	AuthSessionResponse,
	CurrentUserResponse,
	OutpatientPaymentListResponse,
	PatientListResponse,
	ReportDetailResponse,
	ReportListResponse,
	UserProfileResponse,
	UserProfileUpdateRequest,
	WechatPrepayData,
	WechatPrepayResponse,
	WechatPrepayStatusResponse,
} from "../types";

const ACCESS_TOKEN_KEY = "access_token";
const API_BASE_URL_KEY = "api_base_url";
const API_PREFIX_KEY = "api_prefix";
const DEFAULT_API_PREFIX = "/api/v1";

type ApiErrorDetails = {
	statusCode?: number;
	code?: string;
	requestId?: string;
};

type MiniProgramGlobalData = {
	apiBaseUrl: string;
	apiPrefix: string;
	accessToken: string;
	sessionStatus: string;
};

type ApiConfig = {
	apiBaseUrl: string;
	apiPrefix: string;
	accessToken: string;
};

type PaymentParams = WechatPrepayData["payParams"];

/**
 * 服务端错误码是稳定 contract，用户文案不能依赖 provider 或旧服务返回的英文 message。
 * 未列出的业务错误仍可使用服务端安全 message 作为兜底，但禁止把 provider 原始报文透传到页面。
 */
const CLIENT_ERROR_MESSAGES: Readonly<Record<string, string>> = Object.freeze({
	unauthorized: "登录状态已失效，请重新登录",
	"dependency-not-configured": "该服务暂未配置完成，请稍后重试",
	"provider-request-rejected": "外部服务拒绝了本次请求，请稍后重试",
	"provider-temporarily-unavailable": "外部服务暂时不可用，请稍后重试",
	"persistence-temporarily-unavailable": "数据服务暂时不可用，请稍后重试",
});

/** API 错误保留状态码和服务端安全错误码，页面只展示 message。 */
export class ApiError extends Error {
	readonly statusCode: number;
	readonly code: string;
	readonly requestId: string;

	constructor(
		message: string,
		{
			statusCode = 0,
			code = "api-request-failed",
			requestId = "",
		}: ApiErrorDetails = {},
	) {
		super(message);
		this.name = "ApiError";
		this.statusCode = statusCode;
		this.code = code;
		this.requestId = requestId;
	}
}

function globalData(): MiniProgramGlobalData {
	return (getApp() as unknown as { globalData: MiniProgramGlobalData })
		.globalData;
}

/**
 * 读取平台地址、版本前缀和会话；小程序不保存或读取任何 provider 密钥。
 * 生产环境使用 /api/v2，开发环境默认兼容 API 进程的 /api/v1。
 */
function getAppConfig(): ApiConfig {
	const appData = globalData();
	const storedBaseUrl = wx.getStorageSync(API_BASE_URL_KEY);
	const storedApiPrefix = wx.getStorageSync(API_PREFIX_KEY);
	return {
		// 以 app.ts 的版本化配置为准，旧缓存只在没有代码配置时兜底，避免刷新后回到旧 API。
		apiBaseUrl: normalizeApiBaseUrl(appData.apiBaseUrl || storedBaseUrl || ""),
		apiPrefix: String(
			appData.apiPrefix || storedApiPrefix || DEFAULT_API_PREFIX,
		).replace(/\/$/, ""),
		accessToken: String(
			appData.accessToken || wx.getStorageSync(ACCESS_TOKEN_KEY) || "",
		),
	};
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null;
}

/**
 * API base URL 只表示域名和端口，不携带 /api/v1 或 /api/v2 路径。
 * 清理旧缓存可避免请求被拼成 /api/v1/api/v2/... 导致公网 404。
 */
export function normalizeApiBaseUrl(value: unknown): string {
	if (!isAllowedApiBaseUrl(value)) return "";
	const match = String(value)
		.trim()
		.match(/^(https?:\/\/[^/?#]+)/i);
	const origin = match?.[1];
	return origin ? origin.replace(/\/$/, "") : "";
}

/**
 * 只允许平台 API 的版本前缀，避免把本地存储中的任意路径拼进请求地址。
 */
export function isAllowedApiPrefix(value: unknown): value is `/api/v${number}` {
	return typeof value === "string" && /^\/api\/v\d+$/.test(value.trim());
}

/**
 * 微信开发者工具允许本机 HTTP；除此之外，API 地址必须是 HTTPS。
 * 这样即使误把公网 HTTP 地址写进本地存储，也不会把 Bearer token 发出去。
 */
export function isAllowedApiBaseUrl(value: unknown): value is string {
	if (typeof value !== "string") return false;
	const normalized = value.trim();
	if (/^https:\/\/[^/\s@?#]+(?:[/?#].*)?$/i.test(normalized)) return true;
	return /^http:\/\/(?:127\.0\.0\.1|localhost)(?::\d+)?(?:[/?#].*)?$/i.test(
		normalized,
	);
}

function setAccessToken(accessToken: string): void {
	globalData().accessToken = accessToken;
	if (accessToken) {
		wx.setStorageSync(ACCESS_TOKEN_KEY, accessToken);
	} else {
		wx.removeStorageSync(ACCESS_TOKEN_KEY);
	}
}

function parseErrorMessage(data: unknown, statusCode: number): string {
	const code = parseErrorCode(data);
	const localizedMessage = CLIENT_ERROR_MESSAGES[code];
	if (localizedMessage) return localizedMessage;
	if (
		isRecord(data) &&
		isRecord(data.error) &&
		typeof data.error.message === "string"
	) {
		return data.error.message;
	}
	return `API 请求失败（${statusCode}）`;
}

function parseErrorCode(data: unknown): string {
	if (!isRecord(data) || !isRecord(data.error)) return "api-request-failed";
	return typeof data.error.code === "string" && data.error.code
		? data.error.code
		: "api-request-failed";
}

/** 生成仅用于链路关联的客户端 request id，不是认证凭证。 */
function createRequestId(): string {
	return `mp-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function responseRequestId(
	response: WechatMiniprogram.RequestSuccessCallbackResult,
): string {
	const headers = response.header || {};
	return String(headers["x-request-id"] || headers["X-Request-Id"] || "");
}

/**
 * 所有公网请求都必须经过版本化前缀，包括健康检查。
 * Nginx 通过 /api/v2 做新旧服务隔离，再把内部路径转发给 Elysia；
 * 如果健康检查绕过前缀，就会落到旧服务的根路径并返回 404。
 */
export function buildApiRequestUrl(
	apiBaseUrl: string,
	apiPrefix: string,
	path: string,
): string {
	return `${apiBaseUrl}${apiPrefix}${path}`;
}

/**
 * 通过 Hospital API 访问后端；返回类型由调用方显式声明，禁止业务层退回 any。
 */
export function request<TResponse = unknown>(
	options: ApiRequestOptions,
): Promise<TResponse> {
	const {
		url,
		method = "GET",
		data,
		authenticated = false,
		idempotencyKey,
	} = options;
	const { apiBaseUrl, apiPrefix, accessToken } = getAppConfig();
	if (!apiBaseUrl) {
		return Promise.reject(
			new ApiError("API 地址尚未配置", { code: "api-base-url-missing" }),
		);
	}
	if (!isAllowedApiBaseUrl(apiBaseUrl)) {
		return Promise.reject(
			new ApiError("API 地址必须使用 HTTPS", {
				code: "api-base-url-insecure",
			}),
		);
	}
	if (!isAllowedApiPrefix(apiPrefix)) {
		return Promise.reject(
			new ApiError("API 版本前缀尚未配置", {
				code: "api-prefix-invalid",
			}),
		);
	}

	const requestUrl = buildApiRequestUrl(apiBaseUrl, apiPrefix, url);

	return new Promise<TResponse>((resolve, reject) => {
		const requestId = createRequestId();
		wx.request<WechatMiniprogram.IAnyObject>({
			url: requestUrl,
			method,
			...(data === undefined ? {} : { data }),
			header: {
				"content-type": "application/json",
				"x-request-id": requestId,
				...(idempotencyKey ? { "idempotency-key": idempotencyKey } : {}),
				...(authenticated && accessToken
					? { Authorization: `Bearer ${accessToken}` }
					: {}),
			},
			success: (response) => {
				if (response.statusCode >= 200 && response.statusCode < 300) {
					resolve(response.data as TResponse);
					return;
				}
				const errorData = response.data || {};
				reject(
					new ApiError(parseErrorMessage(errorData, response.statusCode), {
						statusCode: response.statusCode,
						code: parseErrorCode(errorData),
						requestId: responseRequestId(response) || requestId,
					}),
				);
			},
			fail: () =>
				reject(
					new ApiError("网络请求失败，请检查网络或服务地址", {
						code: "network-failed",
						requestId,
					}),
				),
		});
	});
}

/** 使用 wx.login 的临时 code 换取平台会话；openid/session_key 不进入小程序。 */
export function login(): Promise<AuthSessionResponse> {
	return new Promise<AuthSessionResponse>((resolve, reject) => {
		wx.login({
			success: ({ code }) => {
				if (!code) {
					reject(
						new ApiError("微信登录未返回临时凭证", {
							code: "wechat-code-missing",
						}),
					);
					return;
				}
				request<AuthSessionResponse>({
					url: "/auth/wechat",
					method: "POST",
					data: { code },
					authenticated: false,
				})
					.then((payload) => {
						const accessToken = payload.data.accessToken;
						if (!accessToken) {
							reject(
								new ApiError("登录响应缺少平台会话", {
									code: "session-missing",
								}),
							);
							return;
						}
						setAccessToken(accessToken);
						resolve(payload);
					})
					.catch(reject);
			},
			fail: () =>
				reject(new ApiError("微信登录失败", { code: "wechat-login-failed" })),
		});
	});
}

/** 需要会话的请求只在 401 时重新登录一次，避免无限重试。 */
export async function requestWithSession<TResponse>(
	options: ApiRequestOptions,
): Promise<TResponse> {
	const { accessToken } = getAppConfig();
	if (!accessToken) await login();

	try {
		return await request<TResponse>({ ...options, authenticated: true });
	} catch (error) {
		if (!(error instanceof ApiError) || error.statusCode !== 401) throw error;
		setAccessToken("");
		await login();
		return request<TResponse>({ ...options, authenticated: true });
	}
}

/** 验证当前平台会话；响应只包含内部用户 id。 */
export function getCurrentUser(): Promise<CurrentUserResponse> {
	return requestWithSession<CurrentUserResponse>({ url: "/me" });
}

/** 读取普通个人资料；响应不包含微信身份、实名或患者字段。 */
export function getUserProfile(): Promise<UserProfileResponse> {
	return requestWithSession<UserProfileResponse>({ url: "/me/profile" });
}

/** 使用服务端版本号更新普通个人资料，避免多设备静默互相覆盖。 */
export function updateUserProfile(
	input: UserProfileUpdateRequest,
): Promise<UserProfileResponse> {
	return requestWithSession<UserProfileResponse>({
		url: "/me/profile",
		method: "PUT",
		data: input,
	});
}

/** 请求服务端从已认证身份同步患者，不在小程序侧拼 provider 字段。 */
export function syncPatients(
	idempotencyKey: string,
): Promise<PatientListResponse> {
	return requestWithSession<PatientListResponse>({
		url: "/patients/sync",
		method: "POST",
		data: {},
		idempotencyKey,
	});
}

/** 读取服务端白名单后的预约科室目录；小程序不直连众阳 AMC。 */
export function requestAppointmentDepartments(): Promise<AppointmentDepartmentListResponse> {
	return requestWithSession<AppointmentDepartmentListResponse>({
		url: "/appointments/departments",
	});
}

/** 读取服务端白名单后的排班目录。 */
export function requestAppointmentSchedules(options: {
	startDate: string;
	endDate: string;
	departmentId?: string;
	doctorId?: string;
}): Promise<AppointmentScheduleListResponse> {
	const query = [
		`startDate=${encodeURIComponent(options.startDate)}`,
		`endDate=${encodeURIComponent(options.endDate)}`,
		...(options.departmentId
			? [`departmentId=${encodeURIComponent(options.departmentId)}`]
			: []),
		...(options.doctorId
			? [`doctorId=${encodeURIComponent(options.doctorId)}`]
			: []),
	].join("&");
	return requestWithSession<AppointmentScheduleListResponse>({
		url: `/appointments/schedules?${query}`,
	});
}

/** 读取指定内部 patientId 的预约历史。 */
export function requestAppointmentRecords(options: {
	patientId: string;
	startDate: string;
	endDate: string;
}): Promise<AppointmentRecordListResponse> {
	const query = [
		`patientId=${encodeURIComponent(options.patientId)}`,
		`startDate=${encodeURIComponent(options.startDate)}`,
		`endDate=${encodeURIComponent(options.endDate)}`,
	].join("&");
	return requestWithSession<AppointmentRecordListResponse>({
		url: `/appointments/records?${query}`,
	});
}

/** 读取当前用户所选就诊人的门诊费用摘要；provider patId 不进入小程序请求。 */
export function requestOutpatientPaymentRecords(options: {
	patientId: string;
	status: "unpaid" | "paid";
}): Promise<OutpatientPaymentListResponse> {
	const query = [
		`patientId=${encodeURIComponent(options.patientId)}`,
		`status=${encodeURIComponent(options.status)}`,
	].join("&");
	return requestWithSession<OutpatientPaymentListResponse>({
		url: `/payments/outpatient/records?${query}`,
	});
}

/** 读取指定内部 patientId 的报告目录。 */
export function requestReports(options: {
	patientId: string;
	startDate: string;
	endDate: string;
	kind?: "laboratory" | "imaging" | "ecg";
}): Promise<ReportListResponse> {
	const query = [
		`patientId=${encodeURIComponent(options.patientId)}`,
		`startDate=${encodeURIComponent(options.startDate)}`,
		`endDate=${encodeURIComponent(options.endDate)}`,
		...(options.kind ? [`kind=${encodeURIComponent(options.kind)}`] : []),
	].join("&");
	return requestWithSession<ReportListResponse>({
		url: `/reports?${query}`,
	});
}

/** 读取服务端生成的短期 LIS 详情引用。 */
export function requestReportDetail(
	reportId: string,
): Promise<ReportDetailResponse> {
	return requestWithSession<ReportDetailResponse>({
		url: `/reports/${encodeURIComponent(reportId)}`,
	});
}

/** 读取服务端生成的微信调起参数。 */
export function requestWechatPrepay(
	orderId: string,
	idempotencyKey: string,
): Promise<WechatPrepayResponse> {
	return requestWithSession<WechatPrepayResponse>({
		url: `/payments/orders/${encodeURIComponent(orderId)}/wechat-prepay`,
		method: "POST",
		data: {},
		idempotencyKey,
	});
}

/** 从服务端响应中显式提取微信原生调起字段。 */
export function toWechatPaymentParams(payload: unknown): PaymentParams | null {
	if (!isRecord(payload) || !isRecord(payload.data)) return null;
	const params = payload.data.payParams;
	if (!isRecord(params)) return null;
	const appId = params.appId;
	const timeStamp = params.timeStamp;
	const nonceStr = params.nonceStr;
	const packageValue = params.package;
	const paySign = params.paySign;
	if (
		typeof appId !== "string" ||
		!appId ||
		typeof timeStamp !== "string" ||
		!timeStamp ||
		typeof nonceStr !== "string" ||
		!nonceStr ||
		typeof packageValue !== "string" ||
		!packageValue ||
		typeof paySign !== "string" ||
		!paySign ||
		params.signType !== "RSA"
	) {
		return null;
	}
	return {
		appId,
		timeStamp,
		nonceStr,
		package: packageValue,
		signType: "RSA",
		paySign,
	};
}

/** 调起微信支付；调起成功不等于业务订单完成。 */
export async function launchWechatPayment(
	orderId: string,
	idempotencyKey: string,
): Promise<{ status: "launched"; prepay: WechatPrepayResponse }> {
	const prepay = await requestWechatPrepay(orderId, idempotencyKey);
	const paymentParams = toWechatPaymentParams(prepay);
	if (!paymentParams) {
		throw new ApiError("服务端支付参数不可用", {
			code: "wechat-pay-params-missing",
		});
	}

	return new Promise((resolve, reject) => {
		wx.requestPayment({
			...paymentParams,
			success: () => resolve({ status: "launched", prepay }),
			fail: (error) => {
				const errMsg = typeof error?.errMsg === "string" ? error.errMsg : "";
				const cancelled = /cancel/i.test(errMsg);
				reject(
					new ApiError(cancelled ? "用户已取消支付" : "微信支付调起失败", {
						code: cancelled
							? "wechat-payment-cancelled"
							: "wechat-payment-launch-failed",
					}),
				);
			},
		});
	});
}

/** pending/unknown 都不能被页面当作支付失败。 */
export function getWechatPrepay(
	orderId: string,
	idempotencyKey: string,
): Promise<WechatPrepayStatusResponse> {
	return requestWithSession<WechatPrepayStatusResponse>({
		url: `/payments/orders/${encodeURIComponent(orderId)}/wechat-prepay`,
		method: "GET",
		idempotencyKey,
	});
}
