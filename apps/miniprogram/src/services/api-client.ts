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
import { advanceSessionGeneration } from "./session-generation";

const ACCESS_TOKEN_KEY = "access_token";
const API_BASE_URL_KEY = "api_base_url";
const API_PREFIX_KEY = "api_prefix";
const DEFAULT_API_PREFIX = "/api/v1";
const SAFE_UNKNOWN_ERROR_MESSAGE = "服务暂时不可用，请稍后重试";

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
 * 未列出的错误码统一使用安全兜底，禁止把未知服务端 message 当作用户文案。
 */
/**
 * 当前公共 API 错误码的唯一客户端文案表；接口文档验收会检查每个公开 code
 * 都在这里有映射，避免服务端新增错误后小程序回退到内部英文文本。
 */
export const CLIENT_ERROR_MESSAGES: Readonly<Record<string, string>> =
	Object.freeze({
		"api-request-failed": "请求失败，请稍后重试",
		validation: "请求参数校验失败",
		parse: "请求体无法解析",
		"not-found": "请求路径不存在",
		unauthorized: "登录状态已失效，请重新登录",
		"dependency-not-configured": "该服务暂未配置完成，请稍后重试",
		"patient-sync-in-progress": "患者目录正在同步，请稍后刷新",
		"patient-directory-snapshot-unsafe":
			"外部患者目录结果不完整，当前就诊人未更新，请稍后重试",
		"provider-request-rejected": "外部服务拒绝了本次请求，请稍后重试",
		"provider-response-invalid": "外部服务返回数据异常，请稍后重试",
		"provider-temporarily-unavailable": "外部服务暂时不可用，请稍后重试",
		"persistence-temporarily-unavailable": "数据服务暂时不可用，请稍后重试",
		"user-profile-invalid": "个人资料字段不合法",
		"user-profile-conflict": "个人资料已被其他设备修改，请刷新后重试",
		"appointment-query-invalid": "预约排班查询条件不合法",
		"appointment-record-query-invalid": "预约记录查询条件不合法",
		"appointment-record-patient-not-found": "当前就诊人暂无可查询的预约记录",
		"outpatient-payment-query-invalid": "门诊缴费查询条件不合法",
		"report-query-invalid": "报告查询条件不合法",
		"report-patient-not-found": "当前就诊人暂无可查询的报告",
		"report-not-found": "报告详情暂不可用",
		"outpatient-payment-patient-not-found": "当前就诊人暂未建立门诊缴费映射",
		"payment-order-invalid": "创建订单输入不合法",
		"payment-order-not-found": "未找到对应的支付订单",
		"payment-quote-not-found": "服务端报价不存在",
		"payment-quote-expired": "服务端报价已过期，请重新获取报价",
		"payment-idempotency-conflict": "幂等键与已有订单的请求内容冲突",
		"payment-order-conflict": "订单版本已被其他流程更新",
		"payment-notification-rejected": "微信支付通知验签或内容校验失败",
		"payment-notification-conflict": "重复通知与已落库事件冲突",
		"payment-cash-prepay-not-allowed": "当前订单不允许现金预支付",
		"payment-identity-not-found": "支付身份映射不可用",
		"payment-prepay-in-progress": "预支付仍在处理，不能并发创建",
		"payment-prepay-unknown": "预支付结果需向外部服务确认，不能直接重建",
		"api-base-url-missing": "API 地址尚未配置",
		"api-base-url-insecure": "API 地址必须使用 HTTPS",
		"api-prefix-invalid": "API 版本前缀尚未配置",
		"network-failed": "网络请求失败，请检查网络或服务地址",
		"wechat-code-missing": "微信登录未返回临时凭证",
		"session-missing": "登录响应缺少平台会话",
		"wechat-login-failed": "微信登录失败",
		"session-changed": "登录账号已切换，请重新加载",
		"patient-selection-required": "请先登录并选择就诊人",
		"patient-selection-stale": "上次选择的就诊人已失效，请重新选择",
		"patient-not-bound": "当前微信账号暂无绑定的就诊人",
		"patient-clinical-unavailable":
			"该就诊人暂未完成医院档案映射，请选择其他就诊人或刷新",
		"appointment-department-missing": "预约科室不能为空",
		"report-detail-id-missing": "报告详情引用无效",
		"report-detail-response-missing": "服务端未返回报告详情",
		"wechat-pay-params-missing": "服务端支付参数不可用",
		"wechat-payment-cancelled": "用户已取消支付",
		"wechat-payment-launch-failed": "微信支付调起失败",
		unknown: SAFE_UNKNOWN_ERROR_MESSAGE,
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
	const appData = globalData();
	const previousAccessToken = String(
		appData.accessToken || wx.getStorageSync(ACCESS_TOKEN_KEY) || "",
	);
	if (previousAccessToken !== accessToken) {
		// 患者、资料和费用请求不能跨账号复用；只递增不记录 token，避免
		// 会话代际机制本身成为敏感信息存储点。
		advanceSessionGeneration();
	}
	appData.accessToken = accessToken;
	// token 与全局展示状态必须原子地同步；401 清理 token 时不能继续显示“已登录”。
	appData.sessionStatus = accessToken ? "signed_in" : "signed_out";
	if (accessToken) {
		wx.setStorageSync(ACCESS_TOKEN_KEY, accessToken);
	} else {
		wx.removeStorageSync(ACCESS_TOKEN_KEY);
	}
}

/** 将公共错误码映射为小程序稳定中文文案；未知码才使用服务端安全兜底。 */
export function localizedApiErrorMessage(
	code: string,
	fallback: string,
): string {
	return CLIENT_ERROR_MESSAGES[code] ?? fallback;
}

/**
 * 页面只能展示稳定错误码对应的文案，不能直接读取 Error.message。
 *
 * API 响应中的 message 可能来自 provider 或内部异常；即使当前 request 层
 * 已经做过一次映射，页面仍统一经过这里，避免未来新增错误构造点时绕过
 * 脱敏边界。页面自己的业务分支可以先处理特殊 code，再把本函数作为兜底。
 */
export function safeApiErrorMessage(error: unknown, fallback: string): string {
	if (!(error instanceof ApiError)) return fallback;
	return localizedApiErrorMessage(error.code, fallback);
}

function parseErrorMessage(data: unknown): string {
	const code = parseErrorCode(data);
	return localizedApiErrorMessage(code, SAFE_UNKNOWN_ERROR_MESSAGE);
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

/**
 * 生成符合患者同步接口约束的客户端幂等键。
 *
 * 幂等键不是认证凭证，也不承载患者信息；它只用于区分一次同步操作。
 * 不能只使用 `Date.now()`，因为首页和选择页可能在同一毫秒发起不同操作，
 * 而服务端的唯一范围是 owner + provider + key。前缀经过收窄后再叠加时间
 * 与随机尾部，既满足请求头字符约束，也避免页面实例之间误共享操作事实。
 */
export function createIdempotencyKey(prefix: string): string {
	const normalizedPrefix =
		prefix
			.trim()
			.replace(/[^A-Za-z0-9._:-]/g, "-")
			.replace(/^-+|-+$/g, "")
			.slice(0, 32) || "operation";
	const randomSuffix = Math.random().toString(36).slice(2, 10).padEnd(8, "0");
	return `${normalizedPrefix}-${Date.now().toString(36)}-${randomSuffix}`;
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
					new ApiError(parseErrorMessage(errorData), {
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

/** 当前小程序进程内的登录请求；并发页面共享同一个一次性 code 兑换结果。 */
let loginInFlight: Promise<AuthSessionResponse> | null = null;

/** 使用 wx.login 的临时 code 换取平台会话；openid/session_key 不进入小程序。 */
function performLogin(): Promise<AuthSessionResponse> {
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

/**
 * 进程内登录请求单飞，避免首页、患者同步和业务页并发消耗多个一次性 code。
 * 失败后立即清空引用，下一次请求仍可重新发起登录。
 */
export function login(): Promise<AuthSessionResponse> {
	if (loginInFlight) return loginInFlight;

	const promise = performLogin();
	loginInFlight = promise;
	void promise.then(
		() => {
			if (loginInFlight === promise) loginInFlight = null;
		},
		() => {
			if (loginInFlight === promise) loginInFlight = null;
		},
	);
	return promise;
}

/**
 * 需要会话的请求只在 401 时重新登录一次，避免无限重试。
 * 如果其他并发请求已经换得新 token，本请求不能清除新 token，直接复用它重试。
 */
export async function requestWithSession<TResponse>(
	options: ApiRequestOptions,
): Promise<TResponse> {
	let accessToken = getAppConfig().accessToken;
	if (!accessToken) {
		await login();
		accessToken = getAppConfig().accessToken;
	}

	try {
		return await request<TResponse>({ ...options, authenticated: true });
	} catch (error) {
		if (!(error instanceof ApiError) || error.statusCode !== 401) throw error;
		const currentToken = getAppConfig().accessToken;
		if (currentToken && currentToken !== accessToken) {
			return request<TResponse>({ ...options, authenticated: true });
		}
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

/** 读取当前用户所选就诊人的门诊费用摘要；临床患者映射只在服务端解析。 */
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
