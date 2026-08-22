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
import {
	advanceSessionGeneration,
	getSessionGeneration,
	isCurrentSessionGeneration,
} from "./session-generation";
import {
	recordApiRequestObservation,
	sanitizeApiRequestPath,
} from "./api-request-observability";

const ACCESS_TOKEN_KEY = "access_token";
const API_BASE_URL_KEY = "api_base_url";
const API_PREFIX_KEY = "api_prefix";
/** 当前代码实际支持的两个 API 版本；其它版本不能由本地缓存或手工配置带入请求。 */
export type SupportedApiPrefix = "/api/v1" | "/api/v2";
const DEFAULT_API_PREFIX: SupportedApiPrefix = "/api/v1";
const PRODUCTION_API_PREFIX: SupportedApiPrefix = "/api/v2";
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
		"patient-query-invalid": "就诊人查询条件不合法",
		"patient-sync-stale": "本次同步结果已过期，请刷新后重试",
		"patient-directory-snapshot-unsafe":
			"外部患者目录结果不完整，当前就诊人未更新，请稍后重试",
		"patient-directory-reference-conflict":
			"患者医院档案映射存在冲突，当前就诊人未更新，请稍后重试",
		"provider-request-rejected": "外部服务拒绝了本次请求，请稍后重试",
		"provider-response-invalid": "外部服务返回数据异常，请稍后重试",
		"provider-temporarily-unavailable": "外部服务暂时不可用，请稍后重试",
		"persistence-temporarily-unavailable": "数据服务暂时不可用，请稍后重试",
		"persistence-invalid": "数据服务返回异常，请稍后重试",
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
	const storedAccessTokenValue = wx.getStorageSync(ACCESS_TOKEN_KEY);
	const appAccessToken = isUsableAccessToken(appData.accessToken)
		? appData.accessToken
		: "";
	const storedAccessToken = isUsableAccessToken(storedAccessTokenValue)
		? storedAccessTokenValue
		: "";
	const apiBaseUrl = normalizeApiBaseUrl(
		appData.apiBaseUrl || storedBaseUrl || "",
	);
	// 本地开发进程使用 /api/v1，备案域名通过 Nginx 使用 /api/v2。即使旧缓存
	// 中残留了 /api/v3、/api/v999 或带路径的脏值，也只能回退到当前环境的
	// 已知版本，不能把这个值直接拼接到 URL 后再让公网返回 404。
	const fallbackApiPrefix = apiBaseUrl.startsWith("http://")
		? DEFAULT_API_PREFIX
		: PRODUCTION_API_PREFIX;
	return {
		// 以 app.ts 的版本化配置为准，旧缓存只在没有代码配置时兜底，避免刷新后回到旧 API。
		apiBaseUrl,
		apiPrefix: normalizeApiPrefix(
			appData.apiPrefix || storedApiPrefix,
			fallbackApiPrefix,
		),
		// app.ts 与历史版本都可能把本地缓存直接放进全局状态；进入
		// Authorization 前必须重新验证两处来源，不能让损坏的缓存绕过
		// 登录响应同一套 token contract。优先使用内存中的有效快照，
		// 只有它无效或为空时才回退到有效的持久化快照。
		accessToken: appAccessToken || storedAccessToken,
	};
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null;
}

/**
 * 所有受保护读取先验证平台成功包络，再交给业务读模型校验。
 *
 * TypeScript 泛型只描述调用方“希望收到什么”，不能证明微信实际收到的
 * JSON 是 `success: true`。如果这里只把 `data` 当作类型事实，代理把错误
 * 包络或旧版本响应送到页面时，业务层可能把一次失败误显示成空目录。此处
 * 只确认平台包络和对象型 data；患者、预约、费用等业务字段仍由各自的
 * canonical validator 继续检查并白名单重投影。
 */
export function requireSuccessDataResponse<TData>(value: unknown): {
	success: true;
	data: TData;
} {
	if (!isRecord(value) || value.success !== true || !isRecord(value.data)) {
		throw new ApiError("API success response is invalid", {
			code: "provider-response-invalid",
		});
	}
	return { success: true, data: value.data as TData };
}

/**
 * 资料接口的成功响应必须是完整的服务端 canonical 快照。
 *
 * TypeScript 泛型只在编译期存在，微信请求收到的 JSON 仍然是运行时未知值；
 * 如果代理把 `data` 丢失、性别枚举改名，或把版本号变成字符串，资料页继续
 * 把它当成成功响应会展示半套资料，并可能在下一次保存时带着错误 version
 * 形成错误的 409。这里复核页面依赖的字段和基本类型，发现协议错配就
 * fail-closed；字段的业务格式和最终归一化仍以服务端 contract 为准。
 */
export function requireCanonicalUserProfileResponse(
	value: unknown,
): UserProfileResponse {
	if (!isRecord(value) || value.success !== true || !isRecord(value.data)) {
		throw new ApiError("User profile response is invalid", {
			code: "provider-response-invalid",
		});
	}

	const data = value.data;
	const displayName = data.displayName;
	const gender = data.gender;
	const age = data.age;
	const email = data.email;
	const version = data.version;
	if (
		!hasSafeUserProfileText(displayName, 64) ||
		!isUserProfileGender(gender) ||
		!isUserProfileAge(age) ||
		!isUserProfileEmail(email) ||
		!isUserProfileVersion(version)
	) {
		throw new ApiError("User profile response is invalid", {
			code: "provider-response-invalid",
		});
	}

	// 不把代理/旧服务额外返回的字段继续交给页面，避免未来响应扩展时把
	// 身份、实名或患者字段顺着普通资料页面带出。这里的返回对象同时保证
	// 与服务端 domain 的 trim、控制字符、邮箱和版本边界保持同一语义。
	return {
		success: true,
		data: {
			displayName,
			gender,
			age,
			email,
			version,
		},
	};
}

/** 普通资料展示文本与服务端 canonical 读模型共用安全字符边界。 */
function hasSafeUserProfileText(
	value: unknown,
	maxLength: number,
): value is string {
	return (
		typeof value === "string" &&
		value.length > 0 &&
		Array.from(value).length <= maxLength &&
		value === value.trim() &&
		!Array.from(value).some((character) => {
			const code = character.charCodeAt(0);
			return code <= 0x1f || code === 0x7f;
		})
	);
}

function isUserProfileGender(
	value: unknown,
): value is UserProfileResponse["data"]["gender"] {
	return value === "male" || value === "female" || value === "unknown";
}

function isUserProfileAge(
	value: unknown,
): value is UserProfileResponse["data"]["age"] {
	return (
		value === null ||
		(typeof value === "number" &&
			Number.isSafeInteger(value) &&
			value >= 0 &&
			value <= 150)
	);
}

function isUserProfileEmail(
	value: unknown,
): value is UserProfileResponse["data"]["email"] {
	return (
		value === null ||
		(hasSafeUserProfileText(value, 320) && /^\S+@\S+\.\S+$/.test(value))
	);
}

/** 0 代表尚未持久化；正数必须仍落在 MySQL INT UNSIGNED 范围内。 */
function isUserProfileVersion(
	value: unknown,
): value is UserProfileResponse["data"]["version"] {
	return (
		typeof value === "number" &&
		Number.isSafeInteger(value) &&
		value >= 0 &&
		value <= 4_294_967_295
	);
}

const REPORT_KINDS = new Set<
	ReportListResponse["data"]["items"][number]["kind"]
>(["laboratory", "imaging", "ecg"]);

const REPORT_STATUSES = new Set<
	ReportListResponse["data"]["items"][number]["status"]
>(["available", "abnormal"]);

const REPORT_DETAIL_FLAGS = new Set<
	ReportDetailResponse["data"]["items"][number]["flag"]
>(["normal", "high", "low", "critical", "unknown"]);

type ReportKind = ReportListResponse["data"]["items"][number]["kind"];
type ReportStatus = ReportListResponse["data"]["items"][number]["status"];
type ReportDetailFlag = ReportDetailResponse["data"]["items"][number]["flag"];

function isReportKind(value: unknown): value is ReportKind {
	return REPORT_KINDS.has(value as ReportKind);
}

function isReportStatus(value: unknown): value is ReportStatus {
	return REPORT_STATUSES.has(value as ReportStatus);
}

function isReportDetailFlag(value: unknown): value is ReportDetailFlag {
	return REPORT_DETAIL_FLAGS.has(value as ReportDetailFlag);
}

/**
 * 会话响应中的 opaque 字段必须在小程序运行时重新校验。
 *
 * 这些值不是页面展示文本：token 会进入 Authorization 请求头，user id 会
 * 参与当前账号的 owner 关联。因此这里只接受非空、去除首尾空白、无控制
 * 字符且长度受限的字符串；不会把未知字段或未经校验的对象继续传给业务层。
 */
function hasSafeSessionText(
	value: unknown,
	maxLength: number,
): value is string {
	return (
		typeof value === "string" &&
		value.length > 0 &&
		value.length <= maxLength &&
		value === value.trim() &&
		!Array.from(value).some((character) => {
			const code = character.charCodeAt(0);
			return code <= 0x1f || code === 0x7f;
		})
	);
}

const MAX_ACCESS_TOKEN_LENGTH = 512;
const MAX_SESSION_USER_ID_LENGTH = 64;

/**
 * 判断本地缓存 token 是否可以进入认证请求边界。
 *
 * 本地存储不是可信输入：旧版本残留、开发者工具手工写入和异常中断都
 * 可能产生带空白、控制字符或超长正文的值。这里复用登录响应使用的
 * `hasSafeSessionText`，使“缓存恢复”和“服务端登录成功”拥有同一套
 * 最小安全事实；返回 false 时只当作没有可恢复会话，不把原文带进请求头。
 */
export function isUsableAccessToken(value: unknown): value is string {
	return hasSafeSessionText(value, MAX_ACCESS_TOKEN_LENGTH);
}

function invalidSessionResponse(message: string): never {
	throw new ApiError(message, { code: "provider-response-invalid" });
}

/**
 * 登录响应是所有患者业务的会话根；必须完整通过服务端 contract 后才可以
 * 写入本地 token。TypeScript 泛型不能验证微信真实收到的 JSON，所以这里
 * 不允许“有一个 truthy token 就算登录成功”的兼容分支，并且重新投影白名单。
 */
export function requireAuthSessionResponse(
	value: unknown,
): AuthSessionResponse {
	if (
		!isRecord(value) ||
		value.success !== true ||
		!isRecord(value.data) ||
		!hasSafeSessionText(value.data.accessToken, MAX_ACCESS_TOKEN_LENGTH) ||
		value.data.tokenType !== "Bearer" ||
		typeof value.data.expiresInSeconds !== "number" ||
		!Number.isSafeInteger(value.data.expiresInSeconds) ||
		value.data.expiresInSeconds < 1 ||
		!isRecord(value.data.user) ||
		!hasSafeSessionText(value.data.user.id, MAX_SESSION_USER_ID_LENGTH)
	) {
		return invalidSessionResponse("Auth session response is invalid");
	}

	return {
		success: true,
		data: {
			accessToken: value.data.accessToken,
			tokenType: "Bearer",
			expiresInSeconds: value.data.expiresInSeconds,
			user: { id: value.data.user.id },
		},
	};
}

/**
 * 会话恢复只接受当前用户的最小 canonical 引用。
 *
 * `/me` 的 200 不是“任意 JSON 都代表登录有效”：缺少 user.id 时保持当前
 * 会话并继续渲染，会把后续患者查询绑定到不确定的 owner。协议错误在这里
 * fail-closed，401 仍由 requestWithSession 单独负责重新登录和清理 token。
 */
export function requireCurrentUserResponse(
	value: unknown,
): CurrentUserResponse {
	if (
		!isRecord(value) ||
		value.success !== true ||
		!isRecord(value.data) ||
		!isRecord(value.data.user) ||
		!hasSafeSessionText(value.data.user.id, MAX_SESSION_USER_ID_LENGTH)
	) {
		return invalidSessionResponse("Current user response is invalid");
	}

	return {
		success: true,
		data: { user: { id: value.data.user.id } },
	};
}

/** 报告文本不能携带控制字符或首尾空白，避免破坏临床展示和日志边界。 */
function hasSafeReportText(value: unknown, maxLength: number): value is string {
	return (
		typeof value === "string" &&
		value.length > 0 &&
		value.length <= maxLength &&
		value === value.trim() &&
		!Array.from(value).some((character) => {
			const code = character.charCodeAt(0);
			return code <= 0x1f || code === 0x7f;
		})
	);
}

function invalidReportResponse(message: string): never {
	throw new ApiError(message, { code: "provider-response-invalid" });
}

function requiredReportText(value: unknown, maxLength: number): string {
	if (!hasSafeReportText(value, maxLength)) {
		return invalidReportResponse("Report response field is invalid");
	}
	return value;
}

function optionalReportText(
	value: unknown,
	maxLength: number,
): string | undefined {
	if (value === undefined) return undefined;
	return requiredReportText(value, maxLength);
}

/**
 * 报告目录响应必须在小程序接收 JSON 的边界重新投影。
 *
 * TypeScript 泛型不能验证微信实际收到的 JSON；这里同时检查列表总数、
 * 报告来源、状态、公开文本、附件布尔值和短期详情引用。影像/心电当前
 * 没有详情 contract，因此它们携带 `reportId` 时整批拒绝，不能让页面
 * 误以为这些来源已经支持详情。未知字段会被丢弃，坏记录不会被过滤后
 * 伪装成部分成功。
 */
export function requireReportListResponse(value: unknown): ReportListResponse {
	if (!isRecord(value) || value.success !== true || !isRecord(value.data)) {
		return invalidReportResponse("Report list response is invalid");
	}
	const data = value.data;
	if (
		!Array.isArray(data.items) ||
		typeof data.total !== "number" ||
		!Number.isSafeInteger(data.total) ||
		data.total < 0 ||
		data.total !== data.items.length
	) {
		return invalidReportResponse("Report list response total is invalid");
	}

	const seenReportIds = new Set<string>();
	const items: ReportListResponse["data"]["items"] = [];
	for (const item of data.items) {
		if (!isRecord(item) || !isReportKind(item.kind)) {
			return invalidReportResponse("Report list response item is invalid");
		}
		const kind = item.kind;
		const reportId = item.reportId;
		if (
			reportId !== undefined &&
			(!hasSafeReportText(reportId, 128) || seenReportIds.has(reportId))
		) {
			return invalidReportResponse("Report list response item is invalid");
		}
		if (kind !== "laboratory" && reportId !== undefined) {
			return invalidReportResponse("Report list response item is invalid");
		}
		if (
			!hasSafeReportText(item.title, 256) ||
			!hasSafeReportText(item.reportedAt, 64) ||
			!isReportStatus(item.status) ||
			typeof item.hasAttachment !== "boolean"
		) {
			return invalidReportResponse("Report list response item is invalid");
		}
		if (reportId !== undefined) seenReportIds.add(reportId);
		items.push({
			...(reportId === undefined ? {} : { reportId }),
			kind,
			title: item.title,
			reportedAt: item.reportedAt,
			status: item.status,
			hasAttachment: item.hasAttachment,
		});
	}
	return { success: true, data: { items, total: data.total } };
}

/**
 * 报告详情响应必须与请求的 opaque `reportId` 精确对应。
 *
 * 详情包含临床结果，不能使用 `report.items || []` 把损坏响应降级为空；
 * 必须校验完整包络、报告引用、检验来源、检测项枚举和所有展示文本，
 * 再重新投影白名单字段。服务端仍负责 owner、患者和 TTL 授权，这里只
 * 负责阻止错误响应进入当前页面状态。
 */
export function requireReportDetailResponse(
	value: unknown,
	expectedReportId: string,
): ReportDetailResponse {
	if (
		!hasSafeReportText(expectedReportId, 128) ||
		!isRecord(value) ||
		value.success !== true ||
		!isRecord(value.data)
	) {
		return invalidReportResponse("Report detail response is invalid");
	}
	const data = value.data;
	if (
		!hasSafeReportText(data.reportId, 128) ||
		data.reportId !== expectedReportId ||
		data.kind !== "laboratory" ||
		!hasSafeReportText(data.title, 256) ||
		!hasSafeReportText(data.reportedAt, 64) ||
		!Array.isArray(data.items) ||
		typeof data.hasAttachment !== "boolean"
	) {
		return invalidReportResponse("Report detail response is invalid");
	}

	const items: ReportDetailResponse["data"]["items"] = [];
	for (const item of data.items) {
		if (
			!isRecord(item) ||
			!hasSafeReportText(item.name, 256) ||
			!hasSafeReportText(item.result, 256) ||
			!isReportDetailFlag(item.flag)
		) {
			return invalidReportResponse("Report detail item is invalid");
		}
		const unit = optionalReportText(item.unit, 64);
		const referenceRange = optionalReportText(item.referenceRange, 256);
		items.push({
			name: item.name,
			result: item.result,
			...(unit === undefined ? {} : { unit }),
			...(referenceRange === undefined ? {} : { referenceRange }),
			flag: item.flag,
		});
	}
	return {
		success: true,
		data: {
			reportId: data.reportId,
			kind: "laboratory",
			title: data.title,
			reportedAt: data.reportedAt,
			items,
			hasAttachment: data.hasAttachment,
		},
	};
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
 * 只允许当前已经注册且经过 Nginx 约定的 API 版本，避免把未来版本、任意
 * 子路径或本地存储中的脏值拼进请求地址。新增版本时必须同步 app、Nginx、
 * 文档和验收，不允许客户端通过正则自动“兼容”未知版本。
 */
export function isAllowedApiPrefix(
	value: unknown,
): value is SupportedApiPrefix {
	return value === "/api/v1" || value === "/api/v2";
}

/**
 * 清理 API 版本前缀的运行时输入。
 *
 * `fallback` 由调用方根据运行环境选择：本地 HTTP 回退内部 `/api/v1`，
 * 公网 HTTPS 回退隔离旧服务的 `/api/v2`。这样既兼容旧开发缓存，又不会在
 * 生产环境因缓存污染而悄悄请求旧公网入口。
 */
export function normalizeApiPrefix(
	value: unknown,
	fallback: SupportedApiPrefix = DEFAULT_API_PREFIX,
): SupportedApiPrefix {
	const normalized =
		typeof value === "string" ? value.trim().replace(/\/$/, "") : "";
	return isAllowedApiPrefix(normalized) ? normalized : fallback;
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

/**
 * 只有请求开始时记录的会话代际仍然有效，认证响应才可以交给业务层。
 *
 * 微信请求不会因为 token 被替换而自动取消；如果用户在网络等待期间
 * 切换了账号，旧请求即使返回 200，也只证明旧账号的读取成功。这里在
 * 客户端丢弃这份响应，避免患者、资料、报告或费用快照跨账号进入页面。
 * 这不是写入操作的回滚机制，因此支付和资料更新仍必须依赖服务端幂等、
 * 版本冲突及后续查询；本门禁只负责不展示错误会话的响应。
 */
async function requestForSession<TResponse>(
	options: ApiRequestOptions,
	sessionGeneration: number,
	accessToken: string,
): Promise<TResponse> {
	// 这个检查必须发生在 `wx.request` 之前：响应回来后再丢弃只能防止
	// 页面展示旧结果，不能撤销已经由错误账号发出的资料更新、患者同步或
	// 其它命令。配置快照和代际双重比较，分别覆盖正式会话轮换与异常的
	// 直接配置漂移。
	const config = getAppConfig();
	if (
		!isCurrentSessionGeneration(sessionGeneration) ||
		config.accessToken !== accessToken
	) {
		throw new ApiError("Session changed before authenticated request", {
			code: "session-changed",
		});
	}
	const response = await requestWithConfig<TResponse>(
		{
			...options,
			authenticated: true,
		},
		{ ...config, accessToken },
	);
	// 代际通常由 setAccessToken 统一推进，但 app 生命周期、开发者工具或
	// 未来其它组合根仍可能直接改动 globalData。仅检查代际会让这种配置漂移
	// 绕过会话隔离；响应回写前再次比较当前有效 token，确保“代际”和“认证
	// 快照”两条事实链都仍然属于同一账号。这里仍只丢弃响应，不尝试回滚
	// 已经发出的命令；资料更新、患者同步等命令的副作用必须由服务端幂等
	// 和 owner 校验负责。
	if (
		!isCurrentSessionGeneration(sessionGeneration) ||
		getAppConfig().accessToken !== accessToken
	) {
		throw new ApiError(
			"Session changed while authenticated request was pending",
			{
				code: "session-changed",
			},
		);
	}
	return response;
}

/**
 * 执行会话恢复后的 GET，并在“同一代、同一 token”再次 401 时清理它。
 *
 * 首次 401 之后重新登录得到的 token 仍可能因为服务端会话落库延迟、
 * 用户被禁用或网关/应用会话不一致而再次失效。若直接把第二次 401
 * 向上抛出而不清理本地 token，后续页面会反复携带同一无效凭证，用户
 * 看到的就是持续的“Invalid or expired session”。清理必须带双重条件：
 * 只有当前 token 和请求开始时相同、且会话代际没有被其它并发登录推进时，
 * 才能清理；否则说明已经有更新的账号上下文，不能误删新会话。
 */
async function requestAfterSessionRecovery<TResponse>(
	options: ApiRequestOptions,
	sessionGeneration: number,
	accessToken: string,
): Promise<TResponse> {
	try {
		return await requestForSession(options, sessionGeneration, accessToken);
	} catch (error) {
		if (
			error instanceof ApiError &&
			error.statusCode === 401 &&
			isCurrentSessionGeneration(sessionGeneration) &&
			getAppConfig().accessToken === accessToken
		) {
			setAccessToken("");
		}
		throw error;
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
	const requestIdPattern = /^[A-Za-z0-9._:-]{1,128}$/u;
	// HTTP Header 名称大小写不敏感，但微信运行时、Nginx 和不同 mock 实现
	// 不一定使用同一种拼写。逐项按小写比较，避免混合大小写时丢失服务端
	// requestId，导致页面错误只能关联到客户端生成的备用 ID。值仍只接受
	// 字符串，不把异常 header 对象/数字转换后写入 ApiError 或日志链。
	for (const [name, value] of Object.entries(headers)) {
		if (
			name.toLowerCase() === "x-request-id" &&
			typeof value === "string" &&
			requestIdPattern.test(value)
		) {
			return value;
		}
	}
	return "";
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
 * 使用已经取得的配置发出一次微信请求。
 *
 * 受保护请求不能在函数内部再次读取全局 token：调用方可能已经记录了旧
 * 会话代际，但账号切换恰好发生在真正调用 `wx.request` 之前。这里接收
 * 显式配置快照，让 Authorization 与本次请求的代际保持同一事实；页面和
 * 业务服务仍只能使用下面公开的 `request`/`requestWithSession`，不会接触
 * token 快照参数。
 */
function requestWithConfig<TResponse = unknown>(
	options: ApiRequestOptions,
	config: ApiConfig,
): Promise<TResponse> {
	const {
		url,
		method = "GET",
		data,
		authenticated = false,
		idempotencyKey,
	} = options;
	const { apiBaseUrl, apiPrefix, accessToken } = config;
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
	const requestPath = sanitizeApiRequestPath(url);
	const startedAt = Date.now();

	return new Promise<TResponse>((resolve, reject) => {
		const requestId = createRequestId();
		const observe = (
			statusCode: number,
			outcome: "success" | "http-error" | "network-error",
			errorCode?: string,
			resolvedRequestId = requestId,
		) => {
			recordApiRequestObservation({
				requestId: resolvedRequestId,
				method,
				path: requestPath,
				statusCode,
				durationMs: Math.max(0, Date.now() - startedAt),
				outcome,
				...(errorCode ? { errorCode } : {}),
			});
		};
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
				const resolvedRequestId = responseRequestId(response) || requestId;
				if (response.statusCode >= 200 && response.statusCode < 300) {
					observe(response.statusCode, "success", undefined, resolvedRequestId);
					resolve(response.data as TResponse);
					return;
				}
				const errorData = response.data || {};
				const errorCode = parseErrorCode(errorData);
				observe(
					response.statusCode,
					"http-error",
					errorCode,
					resolvedRequestId,
				);
				reject(
					new ApiError(parseErrorMessage(errorData), {
						statusCode: response.statusCode,
						code: errorCode,
						requestId: resolvedRequestId,
					}),
				);
			},
			fail: () => {
				observe(0, "network-error", "network-failed");
				reject(
					new ApiError("网络请求失败，请检查网络或服务地址", {
						code: "network-failed",
						requestId,
					}),
				);
			},
		});
	});
}

/** 通过 Hospital API 访问后端；返回类型由调用方显式声明，禁止业务层退回 any。 */
export function request<TResponse = unknown>(
	options: ApiRequestOptions,
): Promise<TResponse> {
	return requestWithConfig(options, getAppConfig());
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
				request<unknown>({
					url: "/auth/wechat",
					method: "POST",
					data: { code },
					authenticated: false,
				})
					.then(requireAuthSessionResponse)
					.then((payload) => {
						// 只有完整响应通过运行时校验后才能落盘；坏响应不得污染
						// 会话代际，也不得让后续页面误以为已经登录。
						setAccessToken(payload.data.accessToken);
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
	// 登录可能在上一步推进代际；必须在拿到当前 token 后再取快照，
	// 否则首次登录的正常请求会被误判成“旧会话响应”。
	let sessionGeneration = getSessionGeneration();

	try {
		return await requestForSession(options, sessionGeneration, accessToken);
	} catch (error) {
		if (!(error instanceof ApiError) || error.statusCode !== 401) throw error;
		const currentToken = getAppConfig().accessToken;
		const method = options.method ?? "GET";
		if (method !== "GET") {
			// 401 只证明本次请求没有通过当前会话鉴权，不能证明业务命令
			// 可以安全地换一个账号再次执行。资料 PUT、患者同步 POST 和
			// 支付预支付 POST 都可能改变状态或触发外部副作用；如果这里
			// 自动重放，旧页面的请求体/幂等键就可能被带到新账号，产生
			// 跨账号写入或重复命令。即使服务端最终会拒绝，也不能把这
			// 个安全责任交给“通常会 401”的实现细节。
			if (currentToken && currentToken !== accessToken) {
				throw new ApiError("Session changed while a command was pending", {
					code: "session-changed",
					requestId: error.requestId,
				});
			}
			// 当前 token 已被服务端判定失效时只清理本地会话，不自动重新
			// 执行命令。页面会显示登录失效，并由用户在确认当前账号后
			// 重新点击保存/同步/支付，确保新的业务意图重新生成请求。
			setAccessToken("");
			throw error;
		}
		if (currentToken && currentToken !== accessToken) {
			// 并发请求已经完成会话轮换；沿用新 token 重试，并把响应门禁
			// 绑定到新代际，不能继续使用旧请求的快照。这里只对 GET
			// 读取开放，不能把该分支复制给任何写入命令。
			accessToken = currentToken;
			sessionGeneration = getSessionGeneration();
			return requestAfterSessionRecovery(
				options,
				sessionGeneration,
				accessToken,
			);
		}
		// GET 读取在明确失效后可以安全地重新建立一次平台会话；仍然
		// 只允许重试一次，防止失效 token 与登录失败之间形成循环。
		setAccessToken("");
		await login();
		accessToken = getAppConfig().accessToken;
		sessionGeneration = getSessionGeneration();
		return requestAfterSessionRecovery(options, sessionGeneration, accessToken);
	}
}

/**
 * 在已经确认患者上下文后，使用固定会话代际执行一次只读请求。
 *
 * 普通 `requestWithSession` 允许 GET 在 401 后重新登录并重试，这对独立的
 * `/me`、患者目录等入口读取是安全的；但预约记录、报告和门诊费用请求还
 * 携带了上一阶段解析出的 opaque `patientId`。如果页面刚完成 `/me` + 患者
 * 目录确认，随后 token 在真正发请求前被另一页面轮换，自动登录会让旧
 * `patientId` 在新会话下发出。即使服务端最终按 owner 拒绝，旧患者标识也
 * 已经越过了错误会话边界。
 *
 * 这个入口只接受 GET，且不会自动登录或重放。它在同一个同步调用栈中同时
 * 固定当前 token 和代际，再交给 `requestForSession`；请求等待期间若会话
 * 变化，响应会被丢弃。401 只清理仍属于本代的失效 token，调用方必须重新
 * 完成 `/me`、患者目录和业务查询，不能拿旧 patientId 继续尝试。
 */
export async function requestWithStableSession<TResponse>(
	options: ApiRequestOptions,
	expectedSessionGeneration: number,
): Promise<TResponse> {
	if ((options.method ?? "GET") !== "GET") {
		throw new ApiError(
			"Stable session request only supports authenticated GET reads",
			{ code: "session-changed" },
		);
	}

	const config = getAppConfig();
	const accessToken = config.accessToken;
	if (!accessToken || !isCurrentSessionGeneration(expectedSessionGeneration)) {
		throw new ApiError("Session changed before patient-scoped read", {
			code: "session-changed",
		});
	}

	try {
		return await requestForSession(
			{ ...options, method: "GET", authenticated: true },
			expectedSessionGeneration,
			accessToken,
		);
	} catch (error) {
		// 只有当前 token 和代际都没有被其它登录流程替换时，才能清理失效
		// 会话；否则不能误删另一个账号刚建立的新 token。
		if (
			error instanceof ApiError &&
			error.statusCode === 401 &&
			isCurrentSessionGeneration(expectedSessionGeneration) &&
			getAppConfig().accessToken === accessToken
		) {
			setAccessToken("");
		}
		throw error;
	}
}

/** 验证当前平台会话；响应只包含内部用户 id。 */
export function getCurrentUser(): Promise<CurrentUserResponse> {
	return requestWithSession<unknown>({ url: "/me" }).then(
		requireCurrentUserResponse,
	);
}

/**
 * 读取平台普通个人资料快照；响应不包含微信身份、实名或患者字段。
 *
 * 这里的 `getUserProfile` 是 Hospital API 的 `/me/profile` 业务命名，
 * 不是微信的 `wx.getUserProfile` 授权接口。登录只需要 `wx.login()` 的
 * 一次性 code；如果未来要采集头像或昵称，必须另立用户主动触发的授权
 * contract，不能在会话登录或患者初始化时偷偷弹窗/扩大采集范围。
 */
export function getUserProfile(): Promise<UserProfileResponse> {
	return requestWithSession<unknown>({ url: "/me/profile" }).then(
		requireCanonicalUserProfileResponse,
	);
}

/** 使用服务端版本号更新普通个人资料，避免多设备静默互相覆盖。 */
export function updateUserProfile(
	input: UserProfileUpdateRequest,
): Promise<UserProfileResponse> {
	return requestWithSession<unknown>({
		url: "/me/profile",
		method: "PUT",
		data: input,
	}).then(requireCanonicalUserProfileResponse);
}

/** 请求服务端从已认证身份同步患者，不在小程序侧拼 provider 字段。 */
export function syncPatients(
	idempotencyKey: string,
): Promise<PatientListResponse> {
	return requestWithSession<unknown>({
		url: "/patients/sync",
		method: "POST",
		data: {},
		idempotencyKey,
	}).then((payload) =>
		requireSuccessDataResponse<PatientListResponse["data"]>(payload),
	);
}

/** 读取服务端白名单后的预约科室目录；小程序不直连众阳 AMC。 */
export function requestAppointmentDepartments(): Promise<AppointmentDepartmentListResponse> {
	return requestWithSession<unknown>({
		url: "/appointments/departments",
	}).then((payload) =>
		requireSuccessDataResponse<AppointmentDepartmentListResponse["data"]>(
			payload,
		),
	);
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
	return requestWithSession<unknown>({
		url: `/appointments/schedules?${query}`,
	}).then((payload) =>
		requireSuccessDataResponse<AppointmentScheduleListResponse["data"]>(
			payload,
		),
	);
}

/** 读取指定内部 patientId 的预约历史。 */
export function requestAppointmentRecords(
	options: {
		patientId: string;
		startDate: string;
		endDate: string;
	},
	expectedSessionGeneration: number,
): Promise<AppointmentRecordListResponse> {
	const query = [
		`patientId=${encodeURIComponent(options.patientId)}`,
		`startDate=${encodeURIComponent(options.startDate)}`,
		`endDate=${encodeURIComponent(options.endDate)}`,
	].join("&");
	return requestWithStableSession<unknown>(
		{ url: `/appointments/records?${query}` },
		expectedSessionGeneration,
	).then((payload) =>
		requireSuccessDataResponse<AppointmentRecordListResponse["data"]>(payload),
	);
}

/** 读取当前用户所选就诊人的门诊费用摘要；临床患者映射只在服务端解析。 */
export function requestOutpatientPaymentRecords(
	options: {
		patientId: string;
		status: "unpaid" | "paid";
	},
	expectedSessionGeneration: number,
): Promise<OutpatientPaymentListResponse> {
	const query = [
		`patientId=${encodeURIComponent(options.patientId)}`,
		`status=${encodeURIComponent(options.status)}`,
	].join("&");
	return requestWithStableSession<unknown>(
		{ url: `/payments/outpatient/records?${query}` },
		expectedSessionGeneration,
	).then((payload) =>
		requireSuccessDataResponse<OutpatientPaymentListResponse["data"]>(payload),
	);
}

/** 读取指定内部 patientId 的报告目录。 */
export function requestReports(
	options: {
		patientId: string;
		startDate: string;
		endDate: string;
		kind?: "laboratory" | "imaging" | "ecg";
	},
	expectedSessionGeneration: number,
): Promise<ReportListResponse> {
	const query = [
		`patientId=${encodeURIComponent(options.patientId)}`,
		`startDate=${encodeURIComponent(options.startDate)}`,
		`endDate=${encodeURIComponent(options.endDate)}`,
		...(options.kind ? [`kind=${encodeURIComponent(options.kind)}`] : []),
	].join("&");
	return requestWithStableSession<unknown>(
		{ url: `/reports?${query}` },
		expectedSessionGeneration,
	).then(requireReportListResponse);
}

/** 读取服务端生成的短期 LIS 详情引用。 */
export function requestReportDetail(
	options: {
		patientId: string;
		reportId: string;
	},
	expectedSessionGeneration: number,
): Promise<ReportDetailResponse> {
	return requestWithStableSession<unknown>(
		{
			url: `/reports/${encodeURIComponent(options.reportId)}?patientId=${encodeURIComponent(options.patientId)}`,
		},
		expectedSessionGeneration,
	).then((payload) => requireReportDetailResponse(payload, options.reportId));
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
