import type {
	ApiRequestOptions,
	AppointmentDepartmentListResponse,
	AppointmentRecordListResponse,
	AppointmentScheduleListResponse,
	AuthSessionResponse,
	CurrentUserResponse,
	HealthKnowledgeCatalogResponse,
	HealthKnowledgeDiseaseDetailResponse,
	HealthKnowledgeDiseaseListResponse,
	HealthKnowledgeDrugDetailResponse,
	HealthKnowledgeSymptomListResponse,
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
	recordApiRequestObservation,
	sanitizeApiRequestPath,
} from "./api-request-observability";
import { getRegisteredApp } from "./app-runtime-context";
import { isBoundedPatientId } from "./patient-identifiers";
import { notifySessionChanged } from "./session-events";
import {
	advanceSessionGeneration,
	getSessionGeneration,
	isCurrentSessionGeneration,
} from "./session-generation";

const ACCESS_TOKEN_KEY = "access_token";
const API_BASE_URL_KEY = "api_base_url";
const API_PREFIX_KEY = "api_prefix";
/** 当前代码实际支持的两个 API 版本；其它版本不能由本地缓存或手工配置带入请求。 */
export type SupportedApiPrefix = "/api/v1" | "/api/v2";
const DEFAULT_API_PREFIX: SupportedApiPrefix = "/api/v1";
const PRODUCTION_API_PREFIX: SupportedApiPrefix = "/api/v2";
const SAFE_UNKNOWN_ERROR_MESSAGE = "当前信息暂时无法获取，请稍后重试";

/**
 * 这些错误表示本次读取没有完成，但没有证明业务数据为空。
 * 页面传入自己的领域兜底文案时，应优先使用它，让用户知道失败的是
 * “预约信息”“检查报告”还是“缴费记录”；其余稳定业务错误仍使用公共
 * 错误码文案。Provider、网络和持久化的内部拓扑不会因此暴露给用户。
 */
const CONTEXTUAL_READ_ERROR_CODES: ReadonlySet<string> = new Set([
	"api-request-failed",
	"network-failed",
	"persistence-invalid",
	"persistence-temporarily-unavailable",
	"provider-request-rejected",
	"provider-response-invalid",
	"provider-temporarily-unavailable",
]);

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
	/** 最近确认的 owner，用来区分 token 恢复和真实账号切换。 */
	sessionOwnerId?: string;
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
		// 这张表是唯一允许进入小程序页面的错误文案表。技术错误码、Provider
		// 名称和内部服务拓扑只写日志，不让普通用户承担实现细节。
		"api-request-failed": "当前信息暂时无法获取，请稍后重试",
		validation: "暂时无法完成操作，请稍后重试",
		parse: "暂时无法完成操作，请稍后重试",
		"not-found": "暂时找不到相关信息，请稍后重试",
		unauthorized: "登录已过期，请重新登录",
		"dependency-not-configured": "该功能正在完善中，暂时无法使用",
		"patient-sync-in-progress": "就诊人信息正在更新，请稍后再试",
		"patient-query-invalid": "暂时无法获取就诊人，请稍后再试",
		"patient-sync-stale": "就诊人信息已更新，请刷新后再试",
		"patient-directory-snapshot-unsafe": "暂时无法获取就诊人，请稍后再试",
		"patient-directory-reference-conflict":
			"就诊人信息需要重新确认，请刷新后再试",
		"provider-request-rejected": "当前信息暂时无法获取，请稍后重试",
		"provider-response-invalid": "当前信息暂时无法获取，请稍后重试",
		"provider-temporarily-unavailable": "当前信息暂时无法获取，请稍后重试",
		"persistence-temporarily-unavailable": "当前信息暂时无法获取，请稍后重试",
		"persistence-invalid": "当前信息暂时无法获取，请稍后重试",
		"health-knowledge-unavailable": "健康内容暂时无法获取，请稍后再试",
		"health-knowledge-query-invalid": "暂时无法查找健康内容，请稍后再试",
		"health-knowledge-not-found": "未找到相关健康内容",
		"user-profile-invalid": "暂时无法读取个人资料，请稍后再试",
		"user-profile-conflict": "个人资料已更新，请刷新后再试",
		"appointment-query-invalid": "暂时无法查询预约信息，请稍后再试",
		"appointment-record-query-invalid": "暂时无法查询挂号记录，请稍后再试",
		"date-range-invalid": "暂时无法查询，请稍后再试",
		"appointment-record-patient-not-found": "未查询到挂号记录",
		"outpatient-payment-query-invalid": "暂时无法查询缴费记录，请稍后再试",
		"report-query-invalid": "暂时无法查询检查报告，请稍后再试",
		"report-patient-not-found": "未查询到检查报告",
		"report-not-found": "未找到这份报告",
		"outpatient-payment-patient-not-found": "未查询到缴费记录",
		"payment-order-invalid": "暂时无法发起支付，请稍后再试",
		"payment-order-not-found": "未找到这笔支付记录",
		"payment-quote-not-found": "暂时无法获取费用信息，请稍后再试",
		"payment-quote-expired": "费用信息已过期，请重新获取",
		"payment-idempotency-conflict": "操作正在处理中，请稍后查看结果",
		"payment-order-conflict": "订单状态已更新，请刷新后再试",
		"payment-notification-rejected": "支付结果暂时无法确认，请稍后查看",
		"payment-notification-conflict": "支付结果正在确认，请稍后查看",
		"payment-cash-prepay-not-allowed": "当前订单暂不支持支付",
		"payment-identity-not-found": "暂时无法确认支付身份，请稍后再试",
		"payment-prepay-in-progress": "支付正在处理中，请稍后查看",
		"payment-prepay-unknown": "支付结果正在确认，请稍后查看",
		"api-base-url-missing": "服务正在启动，请稍后再试",
		"api-base-url-insecure": "服务地址暂时无法使用，请稍后再试",
		"api-prefix-invalid": "服务正在启动，请稍后再试",
		"app-not-initialized": "服务正在启动，请稍后再试",
		"network-failed": "网络连接不稳定，请稍后再试",
		"wechat-code-missing": "登录未完成，请再试一次",
		"session-missing": "登录未完成，请再试一次",
		"wechat-login-failed": "微信登录未完成，请再试一次",
		"session-changed": "登录状态已更新，请重新加载",
		"patient-selection-required": "请先选择就诊人",
		"patient-selection-stale": "请选择就诊人后再继续",
		"patient-not-bound": "暂未添加就诊人，请先添加",
		"patient-clinical-unavailable": "该就诊人暂时无法使用此服务，请更换就诊人",
		"appointment-department-missing": "请选择预约科室",
		"report-detail-id-missing": "报告链接已失效，请返回上一页重试",
		"report-detail-response-missing": "暂时无法打开报告，请稍后再试",
		"wechat-pay-params-missing": "暂时无法发起支付，请稍后再试",
		"wechat-payment-cancelled": "已取消支付",
		"wechat-payment-launch-failed": "支付未完成，请稍后再试",
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
	const app = getRegisteredApp<{
		globalData?: MiniProgramGlobalData;
	}>();
	if (app?.globalData) return app.globalData;
	throw new ApiError("小程序全局状态尚未初始化，请重新打开小程序", {
		code: "app-not-initialized",
	});
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

/** 底层患者范围请求与页面 helper 共用同一条内部 patientId 形状边界。 */
function requirePatientScopedId(value: unknown): string {
	if (!isBoundedPatientId(value)) {
		throw new ApiError("请先登录并选择就诊人", {
			code: "patient-selection-required",
		});
	}
	return value;
}

/** 严格校验报告查询使用的自然日，不依赖不同 JS 运行时的 Date.parse 猜测。 */
function isCanonicalCalendarDate(value: unknown): value is string {
	if (typeof value !== "string") {
		return false;
	}
	const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
	if (!match) return false;
	const year = Number(match[1]);
	const month = Number(match[2]);
	const day = Number(match[3]);
	const timestamp = Date.UTC(year, month - 1, day);
	const date = new Date(timestamp);
	return (
		date.getUTCFullYear() === year &&
		date.getUTCMonth() === month - 1 &&
		date.getUTCDate() === day
	);
}

/**
 * 预约排班请求使用的标识边界。
 *
 * 科室 ID 和医生 ID 虽然通常来自服务端目录，但它们仍会经过页面事件、
 * 页面栈参数或测试替身；不能因为调用方拿到的是 TypeScript `string`，就把
 * 空白、控制字符或超长值直接编码进 URL。这里与服务端 opaque 标识边界
 * 保持同一形状，但不把“形状合法”误认为已经具备 Provider 授权。
 */
function isBoundedAppointmentRequestIdentifier(
	value: unknown,
): value is string {
	return (
		typeof value === "string" &&
		value.length > 0 &&
		value.length <= 128 &&
		value === value.trim() &&
		!Array.from(value).some((character) => {
			const code = character.charCodeAt(0);
			return code <= 0x1f || code === 0x7f;
		})
	);
}

function invalidAppointmentRequest(message: string): never {
	throw new ApiError(message, { code: "appointment-query-invalid" });
}

function invalidAppointmentRecordRequest(message: string): never {
	throw new ApiError(message, {
		code: "appointment-record-query-invalid",
	});
}

/** 底层排班请求只允许已经登记的 query 字段，禁止静默丢弃调用方意图。 */
const APPOINTMENT_SCHEDULE_REQUEST_FIELDS = new Set([
	"startDate",
	"endDate",
	"departmentId",
	"doctorId",
]);

/** 底层预约历史请求只允许范围和对应日期字段。 */
const APPOINTMENT_RECORD_REQUEST_FIELDS = new Set([
	"patientId",
	"scope",
	"startDate",
	"endDate",
]);

export type AppointmentScheduleRequestOptions = {
	startDate: string;
	endDate: string;
	departmentId?: string;
	doctorId?: string;
};

/**
 * 在真正调用 `wx.request` 前归一化排班请求。
 *
 * 页面层的 `loadAppointmentSchedules` 已有一层校验，但这个底层函数是导出
 * 的公共请求入口，未来页面、回放器或开发工具都可能直接调用。若只依赖
 * 页面校验，异常值仍会污染客户端 requestId、服务端日志和 Provider 查询；
 * 因此请求构造器本身必须再次 fail-closed。日期跨度的最终业务上限仍由
 * 服务端 `AppointmentService` 执行，这里只保证自然日形状和筛选标识安全。
 */
function requireAppointmentScheduleRequestOptions(
	value: unknown,
): AppointmentScheduleRequestOptions {
	if (
		typeof value !== "object" ||
		value === null ||
		Array.isArray(value) ||
		Object.keys(value).some(
			(field) => !APPOINTMENT_SCHEDULE_REQUEST_FIELDS.has(field),
		)
	) {
		return invalidAppointmentRequest("预约排班查询条件不合法");
	}
	const record = value as Record<string, unknown>;
	if (
		!isCanonicalCalendarDate(record.startDate) ||
		!isCanonicalCalendarDate(record.endDate) ||
		record.startDate > record.endDate
	) {
		return invalidAppointmentRequest("预约排班查询条件不合法");
	}
	if (
		record.departmentId !== undefined &&
		!isBoundedAppointmentRequestIdentifier(record.departmentId)
	) {
		return invalidAppointmentRequest("预约排班查询条件不合法");
	}
	if (
		record.doctorId !== undefined &&
		!isBoundedAppointmentRequestIdentifier(record.doctorId)
	) {
		return invalidAppointmentRequest("预约排班查询条件不合法");
	}
	return {
		startDate: record.startDate,
		endDate: record.endDate,
		...(record.departmentId === undefined
			? {}
			: { departmentId: record.departmentId }),
		...(record.doctorId === undefined ? {} : { doctorId: record.doctorId }),
	};
}

export type AppointmentRecordRequestOptions =
	| {
			patientId: string;
			scope: "online";
			startDate: string;
			endDate: string;
	  }
	| {
			patientId: string;
			scope: "all";
	  };

/**
 * 归一化预约历史底层请求，并锁定“范围—日期”一一对应关系。
 *
 * “全部挂号”不允许携带日期，“在线挂号”必须同时携带合法日期；不能让
 * `undefined`、未知 scope 或额外旧端字段在 URL 构造时被静默忽略。这样
 * 同一个函数无论来自页面还是直接调用，都不会把爽约/全部历史误发成另一种
 * 查询，也不会在网络层才暴露一个难以定位的 400。
 */
function requireAppointmentRecordRequestOptions(
	value: unknown,
): AppointmentRecordRequestOptions {
	if (
		typeof value !== "object" ||
		value === null ||
		Array.isArray(value) ||
		Object.keys(value).some(
			(field) => !APPOINTMENT_RECORD_REQUEST_FIELDS.has(field),
		)
	) {
		return invalidAppointmentRecordRequest("预约记录查询条件不合法");
	}
	const record = value as Record<string, unknown>;
	if (!isBoundedPatientId(record.patientId)) {
		return invalidAppointmentRecordRequest("预约记录查询条件不合法");
	}
	if (record.scope === "all") {
		// 即使属性值为 undefined，只要调用方显式带入日期就说明请求对象
		// 已经偏离 canonical union；拒绝它，避免调用方误以为日期生效。
		if (
			Object.hasOwn(record, "startDate") ||
			Object.hasOwn(record, "endDate")
		) {
			return invalidAppointmentRecordRequest("预约记录查询条件不合法");
		}
		return { patientId: record.patientId, scope: "all" };
	}
	if (record.scope !== "online") {
		return invalidAppointmentRecordRequest("预约记录查询条件不合法");
	}
	if (
		!isCanonicalCalendarDate(record.startDate) ||
		!isCanonicalCalendarDate(record.endDate) ||
		record.startDate > record.endDate
	) {
		return invalidAppointmentRecordRequest("预约记录查询条件不合法");
	}
	return {
		patientId: record.patientId,
		scope: "online",
		startDate: record.startDate,
		endDate: record.endDate,
	};
}

/** 报告底层请求的运行时参数投影；无效输入在 requestWithStableSession 之前结束。 */
function requireReportRequestOptions(value: unknown): {
	patientId: string;
	startDate: string;
	endDate: string;
	kind?: "laboratory" | "imaging" | "ecg";
} {
	if (!isRecord(value)) {
		throw new ApiError("报告查询条件不合法", { code: "report-query-invalid" });
	}
	const patientId = requirePatientScopedId(value.patientId);
	if (
		!isCanonicalCalendarDate(value.startDate) ||
		!isCanonicalCalendarDate(value.endDate) ||
		value.startDate > value.endDate ||
		(value.kind !== undefined && !isReportKind(value.kind))
	) {
		throw new ApiError("报告查询条件不合法", { code: "report-query-invalid" });
	}
	return {
		patientId,
		startDate: value.startDate,
		endDate: value.endDate,
		...(value.kind !== undefined ? { kind: value.kind } : {}),
	};
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
 * 健康百科是审核后的医疗内容，不能只依赖 TypeScript 泛型读取微信 JSON。
 * 服务端已经完成一次 contract 校验，但小程序仍处在不可信的网络边界：
 * 代理、旧缓存、错误发布包或接口错配都可能返回结构合法但字段错误的内容。
 * 这里重新投影公开字段，坏响应整批失败，不过滤坏行后伪装成“部分内容”。
 */
function isKnowledgeObject(value: unknown): value is Record<string, unknown> {
	return isRecord(value) && !Array.isArray(value);
}

function hasKnowledgeText(value: unknown, maxLength: number): value is string {
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

function hasKnowledgeBodyText(
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
			const isLineBreak = code === 0x0a || code === 0x0d;
			return (code <= 0x1f && !isLineBreak) || code === 0x7f;
		})
	);
}

function invalidKnowledgeResponse(): never {
	throw new ApiError("Health knowledge response is invalid", {
		code: "provider-response-invalid",
	});
}

type KnowledgePublication =
	HealthKnowledgeCatalogResponse["data"]["publication"];

function requireKnowledgePublication(value: unknown): KnowledgePublication {
	if (
		!isKnowledgeObject(value) ||
		!hasKnowledgeText(value.contentVersion, 64) ||
		!hasKnowledgeText(value.reviewedAt, 64) ||
		!hasKnowledgeText(value.sourceLabel, 128) ||
		!hasKnowledgeText(value.disclaimer, 512)
	) {
		return invalidKnowledgeResponse();
	}
	return {
		contentVersion: value.contentVersion,
		reviewedAt: value.reviewedAt,
		sourceLabel: value.sourceLabel,
		disclaimer: value.disclaimer,
	};
}

function optionalKnowledgeText(
	value: Record<string, unknown>,
	field: string,
	maxLength: number,
	allowLineBreaks = false,
): string | undefined {
	const fieldValue = value[field];
	if (fieldValue === undefined) return undefined;
	if (allowLineBreaks) {
		if (!hasKnowledgeBodyText(fieldValue, maxLength)) {
			return invalidKnowledgeResponse();
		}
		return fieldValue;
	}
	if (!hasKnowledgeText(fieldValue, maxLength))
		return invalidKnowledgeResponse();
	return fieldValue;
}

function requireKnowledgeCatalogItem(
	value: unknown,
): HealthKnowledgeCatalogResponse["data"]["items"][number] {
	if (
		!isKnowledgeObject(value) ||
		!hasKnowledgeText(value.id, 128) ||
		!hasKnowledgeText(value.name, 256)
	) {
		return invalidKnowledgeResponse();
	}
	return { id: value.id, name: value.name };
}

function requireKnowledgeLetterItem(
	value: unknown,
): HealthKnowledgeSymptomListResponse["data"]["items"][number] {
	if (
		!isKnowledgeObject(value) ||
		!hasKnowledgeText(value.id, 128) ||
		!hasKnowledgeText(value.name, 256) ||
		!hasKnowledgeText(value.initialLetter, 8)
	) {
		return invalidKnowledgeResponse();
	}
	return {
		id: value.id,
		name: value.name,
		initialLetter: value.initialLetter,
	};
}

function requireKnowledgeDiseaseSummary(
	value: unknown,
): HealthKnowledgeDiseaseListResponse["data"]["items"][number] {
	if (
		!isKnowledgeObject(value) ||
		!hasKnowledgeText(value.id, 128) ||
		!hasKnowledgeText(value.name, 256) ||
		!hasKnowledgeText(value.initialLetter, 8)
	) {
		return invalidKnowledgeResponse();
	}
	const treatmentDepartment = optionalKnowledgeText(
		value,
		"treatmentDepartment",
		500,
	);
	const symptoms = optionalKnowledgeText(value, "symptoms", 10_000, true);
	return {
		id: value.id,
		name: value.name,
		initialLetter: value.initialLetter,
		...(treatmentDepartment === undefined ? {} : { treatmentDepartment }),
		...(symptoms === undefined ? {} : { symptoms }),
	};
}

function requireKnowledgeListResponse<TItem>(
	value: unknown,
	parseItem: (item: unknown) => TItem,
): { publication: KnowledgePublication; items: TItem[]; total: number } {
	if (!isKnowledgeObject(value) || value.success !== true) {
		return invalidKnowledgeResponse();
	}
	const data = value.data;
	if (
		!isKnowledgeObject(data) ||
		!Array.isArray(data.items) ||
		!Number.isSafeInteger(data.total) ||
		(data.total as number) < 0 ||
		(data.total as number) !== data.items.length
	) {
		return invalidKnowledgeResponse();
	}
	const items = data.items.map(parseItem);
	const ids = new Set<string>();
	for (const item of items) {
		const id = (item as { id?: unknown }).id;
		if (typeof id !== "string" || ids.has(id)) {
			return invalidKnowledgeResponse();
		}
		ids.add(id);
	}
	return {
		publication: requireKnowledgePublication(data.publication),
		items,
		total: data.total as number,
	};
}

/** 健康知识目录/症状/疾病列表分别使用自己的字段白名单。 */
export function requireHealthKnowledgeCatalogResponse(
	value: unknown,
): HealthKnowledgeCatalogResponse {
	const data = requireKnowledgeListResponse(value, requireKnowledgeCatalogItem);
	return { success: true, data };
}

export function requireHealthKnowledgeSymptomListResponse(
	value: unknown,
): HealthKnowledgeSymptomListResponse {
	const data = requireKnowledgeListResponse(value, requireKnowledgeLetterItem);
	return { success: true, data };
}

export function requireHealthKnowledgeDiseaseListResponse(
	value: unknown,
): HealthKnowledgeDiseaseListResponse {
	const data = requireKnowledgeListResponse(
		value,
		requireKnowledgeDiseaseSummary,
	);
	return { success: true, data };
}

function requireKnowledgeDrugReference(
	value: unknown,
): HealthKnowledgeDiseaseDetailResponse["data"]["item"]["availableDrugs"][number] {
	if (!isKnowledgeObject(value)) {
		return invalidKnowledgeResponse();
	}
	if (!hasKnowledgeText(value.drugName, 256)) {
		return invalidKnowledgeResponse();
	}
	if (typeof value.isClickable !== "boolean") {
		return invalidKnowledgeResponse();
	}

	/**
	 * 可点击药品必须携带服务端分配的 opaque `drugId`，否则详情页无法
	 * 建立安全的二次查询范围；不可点击项可以只展示名称，不伪造 id。
	 */
	if (value.isClickable === true) {
		if (!hasKnowledgeText(value.drugId, 128)) {
			return invalidKnowledgeResponse();
		}
		return {
			drugId: value.drugId,
			drugName: value.drugName,
			isClickable: true,
		};
	}

	if (value.drugId !== undefined && !hasKnowledgeText(value.drugId, 128)) {
		return invalidKnowledgeResponse();
	}
	return {
		...(value.drugId !== undefined ? { drugId: value.drugId } : {}),
		drugName: value.drugName,
		isClickable: false,
	};
}

export function requireHealthKnowledgeDiseaseDetailResponse(
	value: unknown,
): HealthKnowledgeDiseaseDetailResponse {
	if (!isKnowledgeObject(value) || value.success !== true) {
		return invalidKnowledgeResponse();
	}
	const data = value.data;
	if (
		!isKnowledgeObject(data) ||
		!isKnowledgeObject(data.item) ||
		!hasKnowledgeText(data.item.id, 128) ||
		!hasKnowledgeText(data.item.diseaseName, 256) ||
		!Array.isArray(data.item.availableDrugs)
	) {
		return invalidKnowledgeResponse();
	}
	const itemRecord = data.item;
	const availableDrugsInput = itemRecord.availableDrugs;
	if (!Array.isArray(availableDrugsInput)) return invalidKnowledgeResponse();
	const drugNames = new Set<string>();
	const availableDrugs = availableDrugsInput.map((drug: unknown) => {
		const normalized = requireKnowledgeDrugReference(drug);
		if (drugNames.has(normalized.drugName)) return invalidKnowledgeResponse();
		drugNames.add(normalized.drugName);
		return normalized;
	});
	const item = {
		id: itemRecord.id,
		diseaseName: itemRecord.diseaseName,
		availableDrugs,
		...Object.fromEntries(
			[
				["diseaseAlias", 500],
				["affectedPart", 500],
				["treatmentDepartment", 500],
				["susceptibleCrowd", 500],
				["cause", 100_000, true],
				["symptoms", 100_000, true],
				["examination", 100_000, true],
				["prevention", 100_000, true],
				["treatment", 100_000, true],
			].flatMap(([field, maxLength, allowLineBreaks]) => {
				const text = optionalKnowledgeText(
					itemRecord,
					field as string,
					maxLength as number,
					allowLineBreaks === true,
				);
				return text === undefined ? [] : [[field, text]];
			}),
		),
	};
	return {
		success: true,
		data: {
			publication: requireKnowledgePublication(data.publication),
			item,
		},
	};
}

export function requireHealthKnowledgeDrugDetailResponse(
	value: unknown,
): HealthKnowledgeDrugDetailResponse {
	if (!isKnowledgeObject(value) || value.success !== true) {
		return invalidKnowledgeResponse();
	}
	const data = value.data;
	if (
		!isKnowledgeObject(data) ||
		!isKnowledgeObject(data.item) ||
		!hasKnowledgeText(data.item.id, 128) ||
		!hasKnowledgeText(data.item.drugName, 256)
	) {
		return invalidKnowledgeResponse();
	}
	const itemRecord = data.item;
	const item = {
		id: itemRecord.id,
		drugName: itemRecord.drugName,
		...Object.fromEntries(
			[
				["manufacturer", 256],
				["chineseName", 256],
				["specifications", 256],
				["treatableDiseases", 500],
				["indications", 100_000, true],
				["usageDosage", 100_000, true],
				["adverseReactions", 100_000, true],
				["contraindications", 100_000, true],
				["interactions", 100_000, true],
				["precautions", 100_000, true],
			].flatMap(([field, maxLength, allowLineBreaks]) => {
				const text = optionalKnowledgeText(
					itemRecord,
					field as string,
					maxLength as number,
					allowLineBreaks === true,
				);
				return text === undefined ? [] : [[field, text]];
			}),
		),
	};
	return {
		success: true,
		data: {
			publication: requireKnowledgePublication(data.publication),
			item,
		},
	};
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

function setAccessToken(accessToken: string, ownerId = ""): void {
	const appData = globalData();
	const previousAccessToken = String(
		appData.accessToken || wx.getStorageSync(ACCESS_TOKEN_KEY) || "",
	);
	const previousOwnerId =
		typeof appData.sessionOwnerId === "string" ? appData.sessionOwnerId : "";
	const nextOwnerId = ownerId.trim();
	if (previousAccessToken !== accessToken) {
		// 患者、资料和费用请求不能跨账号复用；只递增不记录 token，避免
		// 会话代际机制本身成为敏感信息存储点。
		advanceSessionGeneration();
	}
	if (previousAccessToken && !accessToken) {
		// token 失效是一次认证边界，资料仓库需要清掉旧快照；但页面级
		// listener 会忽略这个过渡事件，让 GET 自动恢复可以继续回写成功结果。
		notifySessionChanged("session-invalidated");
	}
	// token 变化可能只是旧 token 过期后的自动恢复，不能把它直接当成
	// “账号已切换”。只有服务端已经确认了新 owner，且 owner 确实不同，
	// 才清理所有页面的患者、资料和费用派生快照。
	if (previousOwnerId && nextOwnerId && previousOwnerId !== nextOwnerId) {
		notifySessionChanged("account-switched");
	}
	appData.accessToken = accessToken;
	if (nextOwnerId) appData.sessionOwnerId = nextOwnerId;
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

/**
 * 将一次患者范围读取失败投影成“当前业务 + 可重试”的用户文案。
 *
 * 不能让预约、报告、费用页面直接展示统一的“当前信息”，也不能因为
 * Provider 失败就返回“未查询到记录”。只有网络/Provider/持久化这类
 * 读取未完成错误使用页面的领域兜底；登录失效、患者未绑定和参数错误
 * 仍必须保留公共错误码的明确引导。
 */
export function contextualApiErrorMessage(
	error: unknown,
	fallback: string,
): string {
	if (
		error instanceof ApiError &&
		CONTEXTUAL_READ_ERROR_CODES.has(error.code)
	) {
		return fallback;
	}
	return safeApiErrorMessage(error, fallback);
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
						setAccessToken(payload.data.accessToken, payload.data.user.id);
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
	return requestWithSession<unknown>({ url: "/me" })
		.then(requireCurrentUserResponse)
		.then((payload) => {
			const appData = globalData();
			const previousOwnerId =
				typeof appData.sessionOwnerId === "string"
					? appData.sessionOwnerId
					: "";
			const ownerId = payload.data.user.id;
			if (previousOwnerId && previousOwnerId !== ownerId) {
				notifySessionChanged("account-switched");
			}
			appData.sessionOwnerId = ownerId;
			return payload;
		});
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

/**
 * 读取已审核发布的健康百科目录。
 *
 * 页面不能把旧库快照或本地 fixture 当作内容；没有发布版本时服务端会
 * fail-closed，客户端只展示可重试的内容不可用状态，不渲染伪造空结果。
 */
export function requestHealthKnowledgeCatalog(
	kind: "part" | "crowd" | "department",
): Promise<HealthKnowledgeCatalogResponse> {
	return requestWithSession<unknown>({
		url: `/knowledge/health/${kind}/list`,
	}).then(requireHealthKnowledgeCatalogResponse);
}

/** 读取指定身体部位的症状目录；symptom id 只用于后续服务端查询。 */
export function requestHealthSymptomsByPart(
	partId: string,
): Promise<HealthKnowledgeSymptomListResponse> {
	return requestWithSession<unknown>({
		url: `/knowledge/health/symptoms/list/part/${encodeURIComponent(partId)}`,
	}).then(requireHealthKnowledgeSymptomListResponse);
}

/** 按已审核目录关系读取疾病摘要，不把 provider 参数传入小程序。 */
export function requestHealthDiseasesByRelation(
	kind: "part" | "crowd" | "department",
	id: string,
): Promise<HealthKnowledgeDiseaseListResponse> {
	return requestWithSession<unknown>({
		url: `/knowledge/health/disease/list/${kind}/${encodeURIComponent(id)}`,
	}).then(requireHealthKnowledgeDiseaseListResponse);
}

/** 根据已选择症状查询疾病摘要；服务端负责版本一致性和数量上限。 */
export function requestHealthDiseasesBySymptoms(
	symptomIds: readonly string[],
): Promise<HealthKnowledgeDiseaseListResponse> {
	const query = symptomIds
		.map((symptomId) => `symptomIds=${encodeURIComponent(symptomId)}`)
		.join("&");
	return requestWithSession<unknown>({
		url: `/knowledge/health/disease/list/symptoms?${query}`,
	}).then(requireHealthKnowledgeDiseaseListResponse);
}

/** 读取疾病详情；药品引用必须由详情页再次通过服务端查询。 */
export function requestHealthDiseaseDetail(
	diseaseId: string,
): Promise<HealthKnowledgeDiseaseDetailResponse> {
	return requestWithSession<unknown>({
		url: `/knowledge/health/disease/detail/${encodeURIComponent(diseaseId)}`,
	}).then(requireHealthKnowledgeDiseaseDetailResponse);
}

/** 读取药品详情；页面必须保留免责声明，不把内容渲染为处方建议。 */
export function requestHealthDrugDetail(
	drugId: string,
): Promise<HealthKnowledgeDrugDetailResponse> {
	return requestWithSession<unknown>({
		url: `/knowledge/health/drug/detail/${encodeURIComponent(drugId)}`,
	}).then(requireHealthKnowledgeDrugDetailResponse);
}

/**
 * 将排班查询条件编码为 HTTP query。
 *
 * 这一步单独暴露为纯函数，既让请求入口和测试共享完全相同的归一化，
 * 也让未来新增页面不能绕过底层字段白名单。它只负责查询表达，不代表
 * 该排班已可锁号或已获得预约写入授权。
 */
export function buildAppointmentScheduleQuery(
	options: AppointmentScheduleRequestOptions,
): string {
	const normalized = requireAppointmentScheduleRequestOptions(options);
	return [
		`startDate=${encodeURIComponent(normalized.startDate)}`,
		`endDate=${encodeURIComponent(normalized.endDate)}`,
		...(normalized.departmentId
			? [`departmentId=${encodeURIComponent(normalized.departmentId)}`]
			: []),
		...(normalized.doctorId
			? [`doctorId=${encodeURIComponent(normalized.doctorId)}`]
			: []),
	].join("&");
}

/** 读取服务端白名单后的排班目录。 */
export function requestAppointmentSchedules(
	options: AppointmentScheduleRequestOptions,
): Promise<AppointmentScheduleListResponse> {
	const query = buildAppointmentScheduleQuery(options);
	return requestWithSession<unknown>({
		url: `/appointments/schedules?${query}`,
	}).then((payload) =>
		requireSuccessDataResponse<AppointmentScheduleListResponse["data"]>(
			payload,
		),
	);
}

/** 将预约记录契约编码为 HTTP query；这里不允许省略 scope 或混入错误范围的日期。 */
export function buildAppointmentRecordQuery(
	options: AppointmentRecordRequestOptions,
): string {
	const normalized = requireAppointmentRecordRequestOptions(options);
	return [
		`patientId=${encodeURIComponent(normalized.patientId)}`,
		`scope=${encodeURIComponent(normalized.scope)}`,
		...(normalized.scope === "online"
			? [
					`startDate=${encodeURIComponent(normalized.startDate)}`,
					`endDate=${encodeURIComponent(normalized.endDate)}`,
				]
			: []),
	].join("&");
}

/** 读取指定内部 patientId 的预约历史。 */
export function requestAppointmentRecords(
	options: AppointmentRecordRequestOptions,
	expectedSessionGeneration: number,
): Promise<AppointmentRecordListResponse> {
	const query = buildAppointmentRecordQuery(options);
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
	const patientId = requirePatientScopedId(options?.patientId);
	if (options?.status !== "unpaid" && options?.status !== "paid") {
		// 底层函数也必须守住状态枚举；不能依赖页面事件或 TypeScript 类型，
		// 否则旧页面的未知值可能被编码后交给服务端再误解为另一种状态。
		throw new ApiError("门诊缴费查询条件不合法", {
			code: "outpatient-payment-query-invalid",
		});
	}
	const query = [
		`patientId=${encodeURIComponent(patientId)}`,
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
	const normalizedOptions = requireReportRequestOptions(options);
	const query = [
		`patientId=${encodeURIComponent(normalizedOptions.patientId)}`,
		`startDate=${encodeURIComponent(normalizedOptions.startDate)}`,
		`endDate=${encodeURIComponent(normalizedOptions.endDate)}`,
		...(normalizedOptions.kind
			? [`kind=${encodeURIComponent(normalizedOptions.kind)}`]
			: []),
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
	const patientId = requirePatientScopedId(options?.patientId);
	if (!isBoundedPatientId(options?.reportId)) {
		throw new ApiError("报告详情引用无效", {
			code: "report-detail-id-missing",
		});
	}
	return requestWithStableSession<unknown>(
		{
			url: `/reports/${encodeURIComponent(options.reportId)}?patientId=${encodeURIComponent(patientId)}`,
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
