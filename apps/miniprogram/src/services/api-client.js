const ACCESS_TOKEN_KEY = "access_token";
const API_BASE_URL_KEY = "api_base_url";

/** API 错误保留状态码和服务端安全错误码，页面只展示 message。 */
export class ApiError extends Error {
	/** @param {string} message @param {{statusCode?: number, code?: string, requestId?: string}} [details] */
	constructor(
		message,
		{ statusCode = 0, code = "api-request-failed", requestId = "" } = {},
	) {
		super(message);
		this.name = "ApiError";
		this.statusCode = statusCode;
		this.code = code;
		this.requestId = requestId;
	}
}

/** 读取会话和地址；小程序不保存或读取任何 provider 密钥。 */
function getAppConfig() {
	const globalData = getApp().globalData;
	const storedBaseUrl = wx.getStorageSync(API_BASE_URL_KEY);
	return {
		apiBaseUrl: String(storedBaseUrl || globalData.apiBaseUrl || "").replace(
			/\/$/,
			"",
		),
		accessToken: String(
			globalData.accessToken || wx.getStorageSync(ACCESS_TOKEN_KEY) || "",
		),
	};
}

/** @param {string} accessToken */
function setAccessToken(accessToken) {
	getApp().globalData.accessToken = accessToken;
	if (accessToken) {
		wx.setStorageSync(ACCESS_TOKEN_KEY, accessToken);
	} else {
		wx.removeStorageSync(ACCESS_TOKEN_KEY);
	}
}

/**
 * 微信开发者工具允许本机 HTTP；除此之外，API 地址必须是 HTTPS。
 * 这样即使误把公网 HTTP 地址写进本地存储，也不会把 Bearer token 发出去。
 * @param {unknown} value
 */
export function isAllowedApiBaseUrl(value) {
	if (typeof value !== "string") return false;
	const normalized = value.trim();
	if (/^https:\/\/[^/\s@?#]+(?:[/?#].*)?$/i.test(normalized)) return true;
	return /^http:\/\/(?:127\.0\.0\.1|localhost)(?::\d+)?(?:[/?#].*)?$/i.test(
		normalized,
	);
}

/** @param {unknown} data @param {number} statusCode */
function parseErrorMessage(data, statusCode) {
	let message;
	if (typeof data === "object" && data !== null && "error" in data) {
		const error = data.error;
		if (typeof error === "object" && error !== null && "message" in error) {
			message = error.message;
		}
	}
	return typeof message === "string" && message
		? message
		: `API 请求失败（${statusCode}）`;
}

/** @param {unknown} data */
function parseErrorCode(data) {
	if (typeof data !== "object" || data === null || !("error" in data)) {
		return "api-request-failed";
	}
	const error = data.error;
	if (typeof error !== "object" || error === null || !("code" in error)) {
		return "api-request-failed";
	}
	return typeof error.code === "string" && error.code
		? error.code
		: "api-request-failed";
}

/**
 * 生成仅用于链路关联的客户端 request id；它不是认证凭证，也不进入业务数据。
 * 服务端会校验格式并把它写入 Pino HTTP 日志和响应头。
 */
function createRequestId() {
	return `mp-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

/** @param {WechatMiniprogram.RequestSuccessCallbackResult} response */
function responseRequestId(response) {
	const headers = response.header || {};
	return String(headers["x-request-id"] || headers["X-Request-Id"] || "");
}

/**
 * @param {{url: string, method?: 'GET'|'POST'|'PUT'|'DELETE', data?: WechatMiniprogram.IAnyObject, authenticated?: boolean, idempotencyKey?: string}} options
 * @returns {Promise<any>}
 */
export function request({
	url,
	method = "GET",
	data,
	authenticated = false,
	idempotencyKey,
}) {
	const { apiBaseUrl, accessToken } = getAppConfig();
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

	return new Promise((resolve, reject) => {
		const requestId = createRequestId();
		wx.request({
			url: `${apiBaseUrl}${url}`,
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
					resolve(response.data);
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
			fail: (_error) =>
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
export function login() {
	return new Promise((resolve, reject) => {
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
				request({
					url: "/api/v1/auth/wechat",
					method: "POST",
					data: { code },
					authenticated: false,
				})
					.then((payload) => {
						const accessToken = payload?.data?.accessToken;
						if (typeof accessToken !== "string" || !accessToken) {
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
 * 需要会话的请求只在 401 时重新登录一次，避免失效 token 造成无限重试。
 * 业务响应仍由服务端状态和权限决定，小程序不自行推导支付成功。
 * @param {{url: string, method?: 'GET'|'POST'|'PUT'|'DELETE', data?: WechatMiniprogram.IAnyObject, idempotencyKey?: string}} options
 * @returns {Promise<any>}
 */
export async function requestWithSession(options) {
	const { accessToken } = getAppConfig();
	if (!accessToken) await login();

	try {
		return await request({ ...options, authenticated: true });
	} catch (error) {
		if (!(error instanceof ApiError) || error.statusCode !== 401) throw error;
		setAccessToken("");
		await login();
		return request({ ...options, authenticated: true });
	}
}

/** 验证当前平台会话仍有效；响应只包含内部用户 id，不包含 provider subject。 */
export function getCurrentUser() {
	return requestWithSession({
		url: "/api/v1/me",
		method: "GET",
	});
}

/**
 * 请求服务端从已认证的 provider 身份同步就诊人。
 * unionId、provider 患者号和 provider 原始响应都不进入小程序请求或响应边界。
 * @param {string} idempotencyKey
 */
export function syncPatients(idempotencyKey) {
	return requestWithSession({
		url: "/api/v1/patients/sync",
		method: "POST",
		data: {},
		idempotencyKey,
	});
}

/** 读取服务端白名单后的预约科室目录；小程序不直连众阳 AMC。 */
export function requestAppointmentDepartments() {
	return requestWithSession({
		url: "/api/v1/appointments/departments",
		method: "GET",
	});
}

/**
 * 读取服务端白名单后的排班目录。
 * 只拼接平台定义的四个过滤字段，避免把任意 query 透传给 provider。
 * @param {{startDate: string, endDate: string, departmentId?: string, doctorId?: string}} options
 */
export function requestAppointmentSchedules(options) {
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
	return requestWithSession({
		url: `/api/v1/appointments/schedules?${query}`,
		method: "GET",
	});
}

/**
 * 读取指定内部 patientId 的预约历史；服务端负责 owner 校验和 provider lookup。
 * 小程序不接收 provider appointmentInfoId、费用或支付字段。
 * @param {{patientId: string, startDate: string, endDate: string}} options
 */
export function requestAppointmentRecords(options) {
	const query = [
		`patientId=${encodeURIComponent(options.patientId)}`,
		`startDate=${encodeURIComponent(options.startDate)}`,
		`endDate=${encodeURIComponent(options.endDate)}`,
	].join("&");
	return requestWithSession({
		url: `/api/v1/appointments/records?${query}`,
		method: "GET",
	});
}

/**
 * 读取指定内部 patientId 的报告目录；服务端会按当前会话重新解析 provider 患者号。
 * 小程序只传平台 id 和有限日期筛选，不接收或拼接众阳报告接口参数。
 * @param {{patientId: string, startDate: string, endDate: string, kind?: 'laboratory'|'imaging'|'ecg'}} options
 */
export function requestReports(options) {
	const query = [
		`patientId=${encodeURIComponent(options.patientId)}`,
		`startDate=${encodeURIComponent(options.startDate)}`,
		`endDate=${encodeURIComponent(options.endDate)}`,
		...(options.kind ? [`kind=${encodeURIComponent(options.kind)}`] : []),
	].join("&");
	return requestWithSession({
		url: `/api/v1/reports?${query}`,
		method: "GET",
	});
}

/**
 * 读取服务端为当前会话生成的短期 LIS 详情引用。
 * 小程序只传 opaque reportId，不接触 provider 报告号、患者号或文件 URL。
 * @param {string} reportId
 */
export function requestReportDetail(reportId) {
	return requestWithSession({
		url: `/api/v1/reports/${encodeURIComponent(reportId)}`,
		method: "GET",
	});
}

/**
 * 读取服务端生成的微信调起参数；小程序不构造 paySign，也不把调起成功当作业务成功。
 * @param {string} orderId
 * @param {string} idempotencyKey
 */
export function requestWechatPrepay(orderId, idempotencyKey) {
	return requestWithSession({
		url: `/api/v1/payments/orders/${encodeURIComponent(orderId)}/wechat-prepay`,
		method: "POST",
		data: {},
		idempotencyKey,
	});
}

/**
 * 从服务端响应中显式提取微信原生调起字段，避免把未知字段透传给微信 API。
 * @param {unknown} payload
 * @returns {{appId: string, timeStamp: string, nonceStr: string, package: string, signType: 'RSA', paySign: string} | null}
 */
export function toWechatPaymentParams(payload) {
	const payloadRecord =
		typeof payload === "object" && payload !== null
			? /** @type {{data?: {payParams?: unknown}}} */ (payload)
			: {};
	const params = payloadRecord.data?.payParams;
	if (typeof params !== "object" || params === null) return null;
	const paramsRecord = /** @type {Record<string, unknown>} */ (params);
	const fields = ["appId", "timeStamp", "nonceStr", "package", "paySign"];
	if (
		fields.some(
			(field) =>
				typeof paramsRecord[field] !== "string" || !paramsRecord[field],
		) ||
		paramsRecord.signType !== "RSA"
	) {
		return null;
	}
	return {
		appId: /** @type {string} */ (paramsRecord.appId),
		timeStamp: /** @type {string} */ (paramsRecord.timeStamp),
		nonceStr: /** @type {string} */ (paramsRecord.nonceStr),
		package: /** @type {string} */ (paramsRecord.package),
		signType: "RSA",
		paySign: /** @type {string} */ (paramsRecord.paySign),
	};
}

/**
 * 调起微信支付；成功只表示 wx.requestPayment 被接受，业务订单状态仍以
 * 服务端通知/查单为准。取消和调起失败都不修改本地订单状态。
 * @param {string} orderId
 * @param {string} idempotencyKey
 * @returns {Promise<{status: 'launched', prepay: any}>}
 */
export async function launchWechatPayment(orderId, idempotencyKey) {
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

/**
 * 读取服务端预支付尝试状态；pending/unknown 都不能被页面当作支付失败。
 * @param {string} orderId
 * @param {string} idempotencyKey
 */
export function getWechatPrepay(orderId, idempotencyKey) {
	return requestWithSession({
		url: `/api/v1/payments/orders/${encodeURIComponent(orderId)}/wechat-prepay`,
		method: "GET",
		idempotencyKey,
	});
}
