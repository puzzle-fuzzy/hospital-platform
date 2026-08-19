import type {
	AppointmentDepartment,
	AppointmentRecord,
	AppointmentSchedule,
	HealthResponse,
	OutpatientPaymentRecord,
	Patient,
	PatientListResponse,
	ReportListResponse,
	ReportQuery,
} from "../types";
import {
	ApiError,
	createIdempotencyKey,
	request,
	requestAppointmentDepartments,
	requestAppointmentRecords,
	requestAppointmentSchedules,
	requestOutpatientPaymentRecords,
	requestReports,
	requestWithSession,
	requireSuccessDataResponse,
	syncPatients,
} from "./api-client";
import {
	isBoundedPatientId,
	requireStoredPatientSelection,
} from "./patient-selection-service";
import { runPatientSync } from "./patient-sync-coordinator";

type ExactListData<T> = {
	items: Array<T>;
	total: number;
};

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasBoundedDisplayText(
	value: unknown,
	maxLength: number,
): value is string {
	return (
		typeof value === "string" &&
		Array.from(value).length > 0 &&
		Array.from(value).length <= maxLength &&
		value === value.trim() &&
		!Array.from(value).some((character) => {
			const code = character.charCodeAt(0);
			return code <= 0x1f || code === 0x7f;
		})
	);
}

/** 客户端列表重投影使用的可选展示字段读取器；null 和控制字符不能静默丢弃。 */
function optionalDisplayText(
	value: unknown,
	maxLength: number,
	message = "List response display field is invalid",
): string | undefined {
	if (value === undefined) return undefined;
	if (!hasBoundedDisplayText(value, maxLength)) {
		throw new ApiError(message, {
			code: "provider-response-invalid",
		});
	}
	return value;
}

/** 门诊账单时间必须保持服务端的中国标准时间文本格式和真实日历值。 */
function isOutpatientBillDateTime(value: unknown): value is string {
	if (typeof value !== "string" || !hasBoundedDisplayText(value, 64)) {
		return false;
	}
	const match = /^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2}):(\d{2})$/.exec(value);
	if (!match) return false;
	const year = Number(match[1]);
	const month = Number(match[2]);
	const day = Number(match[3]);
	const hour = Number(match[4]);
	const minute = Number(match[5]);
	const second = Number(match[6]);
	if (
		year < 1 ||
		month < 1 ||
		month > 12 ||
		day < 1 ||
		hour > 23 ||
		minute > 59 ||
		second > 59
	) {
		return false;
	}
	const candidate = new Date(0);
	candidate.setUTCFullYear(year, month - 1, day);
	candidate.setUTCHours(hour, minute, second, 0);
	return (
		candidate.getUTCFullYear() === year &&
		candidate.getUTCMonth() === month - 1 &&
		candidate.getUTCDate() === day &&
		candidate.getUTCHours() === hour &&
		candidate.getUTCMinutes() === minute &&
		candidate.getUTCSeconds() === second
	);
}

/** 患者资料的展示文本必须和服务端读模型一样没有控制字符或首尾空白。 */
function hasSafePatientText(
	value: unknown,
	maxLength: number,
): value is string {
	return (
		typeof value === "string" &&
		Array.from(value).length > 0 &&
		Array.from(value).length <= maxLength &&
		value === value.trim() &&
		!Array.from(value).some((character) => {
			const code = character.charCodeAt(0);
			return code <= 0x1f || code === 0x7f;
		})
	);
}

const PATIENT_RELATIONSHIPS = new Set<Patient["relationship"]>([
	"self",
	"spouse",
	"child",
	"parent",
	"other",
]);

const PATIENT_SOURCES = new Set<Patient["source"]>([
	"hospital-his",
	"legacy-record",
]);

const PATIENT_CLINICAL_ACCESS = new Set<Patient["clinicalAccess"]>([
	"ready",
	"unavailable",
]);

function isPatientRelationship(
	value: unknown,
): value is Patient["relationship"] {
	return PATIENT_RELATIONSHIPS.has(value as Patient["relationship"]);
}

function isPatientSource(value: unknown): value is Patient["source"] {
	return PATIENT_SOURCES.has(value as Patient["source"]);
}

function isPatientClinicalAccess(
	value: unknown,
): value is Patient["clinicalAccess"] {
	return PATIENT_CLINICAL_ACCESS.has(value as Patient["clinicalAccess"]);
}

/** 服务端患者读模型允许的脱敏卡号形状；完整卡号不得进入页面。 */
const MASKED_CARD_NUMBER_PATTERN =
	/^(?:未绑定|[A-Za-z0-9]{0,5}\*+[A-Za-z0-9]{0,4})$/u;

/** 客户端只复核日期的自然日有效性，不把预约时间解释成设备时区的瞬时点。 */
function isIsoCalendarDate(value: unknown): value is string {
	if (typeof value !== "string") return false;
	const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
	if (!match) return false;
	const year = Number(match[1]);
	const month = Number(match[2]);
	const day = Number(match[3]);
	if (year < 1 || month < 1 || month > 12 || day < 1) return false;
	const candidate = new Date(0);
	candidate.setUTCHours(0, 0, 0, 0);
	candidate.setUTCFullYear(year, month - 1, day);
	return (
		candidate.getUTCFullYear() === year &&
		candidate.getUTCMonth() === month - 1 &&
		candidate.getUTCDate() === day
	);
}

/** 预约目录的标识必须是可回查的短字符串，不能携带控制字符或空白。 */
function isBoundedAppointmentIdentifier(value: unknown): value is string {
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

const APPOINTMENT_TIME_GROUPS = new Set<AppointmentSchedule["timeGroup"]>([
	"point",
	"range",
	"unknown",
]);

function isAppointmentTimeGroup(
	value: unknown,
): value is AppointmentSchedule["timeGroup"] {
	return APPOINTMENT_TIME_GROUPS.has(value as AppointmentSchedule["timeGroup"]);
}

/** 预约目录的每条记录都必须通过运行时 contract，异常时整批拒绝。 */
function invalidAppointmentResponse(message: string): never {
	throw new ApiError(message, {
		code: "provider-response-invalid",
	});
}

function requiredAppointmentText(value: unknown, maxLength: number): string {
	if (!hasSafePatientText(value, maxLength)) {
		return invalidAppointmentResponse(
			"Appointment directory response item is invalid",
		);
	}
	return value;
}

function optionalAppointmentText(
	value: unknown,
	maxLength: number,
): string | undefined {
	if (value === undefined) return undefined;
	return requiredAppointmentText(value, maxLength);
}

const APPOINTMENT_RECORD_STATUSES = new Set<AppointmentRecord["status"]>([
	"scheduled",
	"cancelled",
	"completed",
	"missed",
	"stopped",
	"substituted",
	"registered",
	"unknown",
]);

/**
 * 校验患者端列表响应的总数语义。
 *
 * 当前 API 没有服务端分页，`total` 表示本次响应中完整 `items` 的数量，
 * 不是 provider 的隐藏总量，也不是页数。TypeScript 类型只能约束编译期；
 * 如果网关、缓存或前后端版本错配返回了不一致的 total，页面继续使用就会
 * 同时出现错误总数、错误空态或错误“加载更多”状态。因此在患者业务页的
 * 统一读取边界整批 fail-closed，不能把协议异常降级成空列表。
 */
export function requireExactListData<T>(value: unknown): ExactListData<T> {
	if (!isRecord(value)) {
		throw new ApiError("Patient list response is invalid", {
			code: "provider-response-invalid",
		});
	}
	const data = value as { items?: unknown; total?: unknown };
	if (
		!Array.isArray(data.items) ||
		typeof data.total !== "number" ||
		!Number.isSafeInteger(data.total) ||
		data.total < 0 ||
		data.total !== data.items.length
	) {
		throw new ApiError("Patient list response total is invalid", {
			code: "provider-response-invalid",
		});
	}
	return {
		items: data.items as Array<T>,
		total: data.total,
	};
}

/**
 * 在小程序收到 JSON 的边界重新校验患者读模型。
 *
 * `Patient` 来自 TypeScript 类型和服务端 contract，但微信响应本身仍是
 * 运行时未知数据。只检查 `total` 会让未知关系、未脱敏卡号或重复 patientId
 * 进入页面；重复 ID 还可能让选择页的点击事件命中错误记录。这里整批校验并
 * 重新投影白名单字段，任何一条异常都返回稳定的 provider-response-invalid，
 * 不能把坏目录降级成空列表或继续默认切换患者。
 */
export function requirePatientListData(value: unknown): ExactListData<Patient> {
	const list = requireExactListData<unknown>(value);
	const seenPatientIds = new Set<string>();
	const items: Patient[] = [];
	for (const item of list.items) {
		if (typeof item !== "object" || item === null || Array.isArray(item)) {
			throw new ApiError("Patient response item is invalid", {
				code: "provider-response-invalid",
			});
		}
		const record = item as Record<string, unknown>;
		if (
			typeof record.id !== "string" ||
			!isBoundedPatientId(record.id) ||
			seenPatientIds.has(record.id) ||
			!hasSafePatientText(record.displayName, 128) ||
			!isPatientRelationship(record.relationship) ||
			typeof record.cardNumberMasked !== "string" ||
			!hasSafePatientText(record.cardNumberMasked, 128) ||
			!MASKED_CARD_NUMBER_PATTERN.test(record.cardNumberMasked) ||
			!isPatientSource(record.source) ||
			!isPatientClinicalAccess(record.clinicalAccess)
		) {
			throw new ApiError("Patient response item is invalid", {
				code: "provider-response-invalid",
			});
		}
		seenPatientIds.add(record.id);
		items.push({
			id: record.id,
			displayName: record.displayName,
			relationship: record.relationship,
			cardNumberMasked: record.cardNumberMasked,
			source: record.source,
			clinicalAccess: record.clinicalAccess,
		});
	}
	return { items, total: list.total };
}

/**
 * 小程序级联左栏只接受服务端公开的科室白名单字段。
 *
 * 科室目录虽然不包含患者信息，但仍然是 Provider 结果进入页面的边界；
 * 这里拒绝重复键、控制字符和未知字段以外的非法核心字段，并重新投影
 * 公共对象，避免网关扩展字段被后续页面当成业务事实。
 */
export function requireAppointmentDepartmentListData(
	value: unknown,
): ExactListData<AppointmentDepartment> {
	const list = requireExactListData<unknown>(value);
	const seenDepartmentIds = new Set<string>();
	const items: AppointmentDepartment[] = [];
	for (const item of list.items) {
		if (!isRecord(item)) {
			return invalidAppointmentResponse(
				"Appointment department response item is invalid",
			);
		}
		const departmentId = requiredAppointmentText(item.departmentId, 128);
		if (seenDepartmentIds.has(departmentId)) {
			return invalidAppointmentResponse(
				"Appointment department response item is invalid",
			);
		}
		seenDepartmentIds.add(departmentId);
		const departmentCode = optionalAppointmentText(item.departmentCode, 128);
		const location = optionalAppointmentText(item.location, 256);
		const displayName = requiredAppointmentText(item.displayName, 256);
		items.push({
			departmentId,
			...(departmentCode === undefined ? {} : { departmentCode }),
			displayName,
			...(location === undefined ? {} : { location }),
		});
	}
	return { items, total: list.total };
}

/**
 * 小程序级联右栏只接受当前左栏科室对应的排班读模型。
 *
 * `scheduleId` 只是服务端生成的 opaque 只读引用，不是预约授权；客户端
 * 仍必须校验它唯一、日期真实、号源数量满足 available <= total、时间分组
 * 属于有限枚举，并拒绝“请求科室 A 却返回科室 B”的串台响应。任何一条
 * 异常都整批 fail-closed，不能筛掉坏记录后伪装成完整号源目录。
 */
export function requireAppointmentScheduleListData(
	value: unknown,
	expectedDepartmentId: string,
): ExactListData<AppointmentSchedule> {
	if (!isBoundedAppointmentIdentifier(expectedDepartmentId)) {
		return invalidAppointmentResponse(
			"Appointment department request context is invalid",
		);
	}
	const list = requireExactListData<unknown>(value);
	const seenScheduleIds = new Set<string>();
	const items: AppointmentSchedule[] = [];
	for (const item of list.items) {
		if (!isRecord(item)) {
			return invalidAppointmentResponse(
				"Appointment schedule response item is invalid",
			);
		}
		const scheduleId = requiredAppointmentText(item.scheduleId, 128);
		const departmentId = requiredAppointmentText(item.departmentId, 128);
		const departmentName = requiredAppointmentText(item.departmentName, 256);
		const doctorId = requiredAppointmentText(item.doctorId, 128);
		const doctorName = requiredAppointmentText(item.doctorName, 256);
		const workDate = item.workDate;
		const shiftName = requiredAppointmentText(item.shiftName, 128);
		const startTime = optionalAppointmentText(item.startTime, 32);
		const endTime = optionalAppointmentText(item.endTime, 32);
		const totalSlots = item.totalSlots;
		const availableSlots = item.availableSlots;
		if (
			!isBoundedAppointmentIdentifier(scheduleId) ||
			seenScheduleIds.has(scheduleId) ||
			departmentId !== expectedDepartmentId ||
			!isIsoCalendarDate(workDate) ||
			typeof totalSlots !== "number" ||
			!Number.isSafeInteger(totalSlots) ||
			totalSlots < 0 ||
			typeof availableSlots !== "number" ||
			!Number.isSafeInteger(availableSlots) ||
			availableSlots < 0 ||
			availableSlots > totalSlots ||
			!isAppointmentTimeGroup(item.timeGroup)
		) {
			return invalidAppointmentResponse(
				"Appointment schedule response item is invalid",
			);
		}
		seenScheduleIds.add(scheduleId);
		items.push({
			scheduleId,
			departmentId,
			departmentName,
			doctorId,
			doctorName,
			workDate,
			shiftName,
			...(startTime === undefined ? {} : { startTime }),
			...(endTime === undefined ? {} : { endTime }),
			totalSlots,
			availableSlots,
			timeGroup: item.timeGroup,
		});
	}
	return { items, total: list.total };
}

/**
 * 门诊费用列表必须和本次查询状态保持一致。
 *
 * `total` 一致只能证明数组长度没有错，不能证明“待缴费/已缴费”语义没有
 * 串台。客户端收到的 JSON 不是 TypeScript 事实；这里在页面读取边界再次
 * 校验列表状态、记录标识、账单时间和金额的基本形状，防止代理或版本错配
 * 把已缴记录展示在待缴页，或让非整数金额进入 `toFixed`/支付前置逻辑。
 * Provider 的日期格式、金额来源和最终权限仍由服务端 contract 负责。
 */
export function requireOutpatientPaymentListData(
	value: unknown,
	expectedStatus: "unpaid" | "paid",
): ExactListData<OutpatientPaymentRecord> {
	if (!isRecord(value) || value.status !== expectedStatus) {
		throw new ApiError("Outpatient payment response status is invalid", {
			code: "provider-response-invalid",
		});
	}

	const list = requireExactListData<unknown>(value);
	const seenRecordIds = new Set<string>();
	const items: OutpatientPaymentRecord[] = [];
	for (const item of list.items) {
		if (!isRecord(item)) {
			throw new ApiError("Outpatient payment response item is invalid", {
				code: "provider-response-invalid",
			});
		}
		const recordId = item.recordId;
		const departmentName = optionalDisplayText(
			item.departmentName,
			128,
			"Outpatient payment response item is invalid",
		);
		const doctorName = optionalDisplayText(
			item.doctorName,
			128,
			"Outpatient payment response item is invalid",
		);
		const amountFen = item.amountFen;
		if (
			item.status !== expectedStatus ||
			!hasBoundedDisplayText(recordId, 128) ||
			seenRecordIds.has(recordId) ||
			!isOutpatientBillDateTime(item.billDate) ||
			typeof amountFen !== "number" ||
			!Number.isSafeInteger(amountFen) ||
			amountFen < 0
		) {
			throw new ApiError("Outpatient payment response item is invalid", {
				code: "provider-response-invalid",
			});
		}
		seenRecordIds.add(recordId);
		items.push({
			recordId,
			status: expectedStatus,
			billDate: item.billDate,
			amountFen,
			...(departmentName === undefined ? {} : { departmentName }),
			...(doctorName === undefined ? {} : { doctorName }),
		});
	}
	return {
		items,
		total: list.total,
	};
}

/**
 * 我的挂号列表也必须在客户端边界保持公共读模型形状。
 *
 * 服务端已经完成 Provider 状态和日期的归一化，但 TypeScript 泛型不会
 * 校验微信收到的 JSON。若这里直接把异常状态交给 `toRecordView`，状态文案
 * 可能变成空值；若工作日期或展示字段被代理污染，页面会把错误记录当作
 * 当前患者的预约事实。发现一条坏记录时整批拒绝，不能过滤后伪装成完整
 * 历史；全部渠道仍由独立 contract 决定，不能由这个校验顺手开放。
 */
export function requireAppointmentRecordListData(
	value: unknown,
): ExactListData<AppointmentRecord> {
	const list = requireExactListData<unknown>(value);
	const items: AppointmentRecord[] = [];
	for (const item of list.items) {
		if (!isRecord(item)) {
			throw new ApiError("Appointment record response item is invalid", {
				code: "provider-response-invalid",
			});
		}
		const departmentName = optionalDisplayText(
			item.departmentName,
			128,
			"Appointment record response item is invalid",
		);
		const doctorName = optionalDisplayText(
			item.doctorName,
			128,
			"Appointment record response item is invalid",
		);
		const workTime = optionalDisplayText(
			item.workTime,
			64,
			"Appointment record response item is invalid",
		);
		const location = optionalDisplayText(
			item.location,
			256,
			"Appointment record response item is invalid",
		);
		const serialNumber = optionalDisplayText(
			item.serialNumber,
			64,
			"Appointment record response item is invalid",
		);
		if (
			!APPOINTMENT_RECORD_STATUSES.has(
				item.status as AppointmentRecord["status"],
			) ||
			!isIsoCalendarDate(item.workDate) ||
			typeof item.status !== "string"
		) {
			throw new ApiError("Appointment record response item is invalid", {
				code: "provider-response-invalid",
			});
		}
		items.push({
			status: item.status as AppointmentRecord["status"],
			workDate: item.workDate,
			...(departmentName === undefined ? {} : { departmentName }),
			...(doctorName === undefined ? {} : { doctorName }),
			...(workTime === undefined ? {} : { workTime }),
			...(location === undefined ? {} : { location }),
			...(serialNumber === undefined ? {} : { serialNumber }),
		});
	}
	return {
		items,
		total: list.total,
	};
}

/**
 * 首页只读工作台使用的时间窗口。
 * 这些窗口是产品边界，不是 provider 参数。
 */
export const DASHBOARD_DATE_RANGE_DAYS = Object.freeze({
	appointmentDirectory: 7,
	/** 我的挂号需要同时覆盖近期历史和即将到来的预约。 */
	appointmentRecordsPast: 90,
	appointmentRecordsFuture: 90,
	/** 爽约只能从已经发生的日期中派生，不能把未来预约误算成爽约。 */
	missedAppointmentsPast: 90,
	reports: 30,
});

/**
 * 医院业务日历固定使用中国标准时间，不使用用户设备或 API 进程的时区。
 *
 * 这里不依赖小程序运行时是否完整支持 `Intl` 的 `timeZone` 参数，而是把
 * 绝对时间平移到 UTC+08:00 的伪时间轴，再用 UTC 字段读取自然日。中国
 * 标准时间没有夏令时，这种写法在真机、开发者工具和服务端的日期语义一致。
 */
const PLATFORM_TIME_ZONE_OFFSET_MS = 8 * 60 * 60 * 1000;
const CALENDAR_DAY_MS = 24 * 60 * 60 * 1000;

type PlatformCalendarDate = {
	year: number;
	month: number;
	day: number;
};

function platformCalendarDate(value: Date): PlatformCalendarDate {
	const shifted = new Date(value.getTime() + PLATFORM_TIME_ZONE_OFFSET_MS);
	return {
		year: shifted.getUTCFullYear(),
		month: shifted.getUTCMonth() + 1,
		day: shifted.getUTCDate(),
	};
}

function shiftCalendarDate(
	value: PlatformCalendarDate,
	days: number,
): PlatformCalendarDate {
	const shifted = new Date(
		Date.UTC(value.year, value.month - 1, value.day) + days * CALENDAR_DAY_MS,
	);
	return {
		year: shifted.getUTCFullYear(),
		month: shifted.getUTCMonth() + 1,
		day: shifted.getUTCDate(),
	};
}

function formatCalendarDate(value: PlatformCalendarDate): string {
	const padDatePart = (part: number) => String(part).padStart(2, "0");
	return `${value.year}-${padDatePart(value.month)}-${padDatePart(value.day)}`;
}

/** 将绝对时间按中国标准时间格式化为平台公开 contract 使用的 YYYY-MM-DD。 */
export function formatPlatformDate(value: Date): string {
	return formatCalendarDate(platformCalendarDate(value));
}

/** 创建以中国标准时间“今天”为结束日的查询窗口。 */
export function createPastDateRange(
	days: number,
	now = new Date(),
): { startDate: string; endDate: string } {
	const end = platformCalendarDate(now);
	const start = shiftCalendarDate(end, -days);
	return {
		startDate: formatCalendarDate(start),
		endDate: formatCalendarDate(end),
	};
}

/**
 * 创建“我的挂号”查询窗口：当前中国标准时间日前后各覆盖 90 天。
 *
 * 预约历史既包含已完成/已爽约的过去记录，也包含患者尚未就诊的未来
 * 预约。过去窗口和未来窗口必须在服务层明确表达，不能复用只适用于报告
 * 或爽约派生页的 past-only 查询，否则未来预约会在页面上静默消失。
 */
export function createAppointmentRecordDateRange(now = new Date()): {
	startDate: string;
	endDate: string;
} {
	const today = platformCalendarDate(now);
	return {
		startDate: formatCalendarDate(
			shiftCalendarDate(
				today,
				-DASHBOARD_DATE_RANGE_DAYS.appointmentRecordsPast,
			),
		),
		endDate: formatCalendarDate(
			shiftCalendarDate(
				today,
				DASHBOARD_DATE_RANGE_DAYS.appointmentRecordsFuture,
			),
		),
	};
}

/** 创建从中国标准时间“今天”开始的未来查询窗口。 */
export function createUpcomingDateRange(
	days: number,
	now = new Date(),
): { startDate: string; endDate: string } {
	const start = platformCalendarDate(now);
	const end = shiftCalendarDate(start, days);
	return {
		startDate: formatCalendarDate(start),
		endDate: formatCalendarDate(end),
	};
}

/** 只允许使用服务端返回且通过形状校验的内部 patientId。 */
function requirePatientId(patientId: unknown): string {
	if (!isBoundedPatientId(patientId)) {
		throw new ApiError("请先登录并选择就诊人", {
			code: "patient-selection-required",
		});
	}
	return patientId;
}

/**
 * 门诊费用查询状态必须在发请求前再次做运行时校验。
 *
 * 页面事件通常会把状态限制为 `unpaid`/`paid`，但 TypeScript 类型在微信
 * 运行时不存在，旧页面、手工调用或损坏的事件数据仍可能传入未知字符串。
 * 这里不能等 API 响应阶段才发现错误：那时已经制造了错误的网络和日志语义，
 * 甚至可能让旧网关把未知值按“非 unpaid 即 paid”处理。服务端仍会做最终校验，
 * 本层只是患者端请求前的第一道 fail-closed 门禁。
 */
function isOutpatientPaymentStatus(
	value: unknown,
): value is OutpatientPaymentRecord["status"] {
	return value === "unpaid" || value === "paid";
}

/** 健康检查只证明 API 进程响应，不把 ready 误显示为可用。 */
export function loadHealth(): Promise<HealthResponse> {
	return request<HealthResponse>({ url: "/health/live" });
}

/** 读取当前会话归属的脱敏患者读模型。 */
export function loadPatients(): Promise<Array<Patient>> {
	return requestWithSession<unknown>({
		url: "/patients",
	})
		.then((payload) =>
			requireSuccessDataResponse<PatientListResponse["data"]>(payload),
		)
		.then((payload) => requirePatientListData(payload.data).items);
}

/**
 * 读取患者端业务页当前可用的就诊人。
 *
 * 这里故意只重读最新的 owner-scoped 平台目录，不隐式调用
 * `syncPatientsFromHospital`：登录恢复和独立选择页负责完成医院目录同步，
 * 预约记录、爽约记录、报告和门诊费用页只需要在发起各自查询前确认最新目录
 * 与本地显式选择仍然一致。若每次打开业务页都同步 Provider，页面栈返回、
 * 下拉刷新和多个只读页并发打开就会互相制造同步租约冲突，也会把“页面读取”
 * 错误地升级成一次外部业务操作。
 *
 * `requireStoredPatientSelection` 同时检查首次默认、stale 和临床映射状态，
 * 因此调用方拿到的患者一定是可以进入只读临床查询的 ready 记录；页面不再
 * 各自复制这段容易漏条件的解析逻辑。
 */
export function loadCurrentPatient(): Promise<Patient> {
	return loadPatients().then((patients) =>
		requireStoredPatientSelection(patients),
	);
}

/**
 * 请求服务端从已认证身份同步患者，不在小程序侧拼 provider 字段。
 * 同步请求在进程级协调器内生成幂等键，保证不同页面实例复用同一操作。
 */
export function syncPatientsFromHospital(
	operationPrefix: string,
): Promise<Array<Patient>> {
	return runPatientSync(() =>
		syncPatients(createIdempotencyKey(operationPrefix)).then(
			(payload) => requirePatientListData(payload.data).items,
		),
	);
}

/**
 * 只读取预约一级科室。
 *
 * 预约页采用“两列级联”布局后，排班必须在选中科室后再请求；因此这里
 * 刻意不提供“科室 + 排班”的聚合 helper，不能为了绘制左侧菜单把未来
 * 窗口内的全部排班一次性搬到小程序内存和渲染树，也不能向 Provider 发送
 * 缺少科室范围的宽查询。调用顺序由 appointment-directory 页面控制：
 * 先调用本函数，再把用户明确选择的 departmentId 传给下一个函数。
 */
export function loadAppointmentDepartments(): Promise<
	Array<AppointmentDepartment>
> {
	return requestAppointmentDepartments().then(
		(payload) => requireAppointmentDepartmentListData(payload.data).items,
	);
}

/** 只读取当前科室的排班；服务端仍会校验日期窗口和科室参数。 */
export function loadAppointmentSchedules(
	departmentId: string,
	now = new Date(),
): Promise<Array<AppointmentSchedule>> {
	if (!departmentId) {
		return Promise.reject(
			new ApiError("预约科室不能为空", {
				code: "appointment-department-missing",
			}),
		);
	}
	// 科室 ID 来自 WXML 事件和页面状态，不能因为它“通常由服务端返回”
	// 就跳过运行时校验。空白、控制字符或超长值若先进入 URL，会制造一条
	// 没有业务意义的 Provider 请求；即使响应阶段还能拒绝，也已经污染了
	// 网络和日志链路。这里与排班响应的 `expectedDepartmentId` 使用同一形状
	// 规则，保证请求前和回包后的科室归属校验不会出现两套边界。
	if (!isBoundedAppointmentIdentifier(departmentId)) {
		return Promise.reject(
			new ApiError("预约科室参数不合法", {
				code: "appointment-query-invalid",
			}),
		);
	}
	return requestAppointmentSchedules({
		departmentId,
		...createUpcomingDateRange(
			DASHBOARD_DATE_RANGE_DAYS.appointmentDirectory,
			now,
		),
	}).then(
		(payload) =>
			requireAppointmentScheduleListData(payload.data, departmentId).items,
	);
}

/** 读取门诊费用读模型，日期窗口由服务端统一限制。 */
export function loadOutpatientPaymentRecords(
	patientId: string,
	status: "unpaid" | "paid",
): Promise<Array<OutpatientPaymentRecord>> {
	if (!isOutpatientPaymentStatus(status)) {
		return Promise.reject(
			new ApiError("门诊缴费查询状态不合法", {
				code: "outpatient-payment-query-invalid",
			}),
		);
	}
	// 门诊费用和预约、报告一样属于患者范围查询；即使调用方来自已选患者页面，
	// 也必须在服务层再次拒绝空标识，不能把“当前页面没有患者”转换成一次无效 API 请求。
	return requestOutpatientPaymentRecords({
		patientId: requirePatientId(patientId),
		status,
	}).then(
		(payload) => requireOutpatientPaymentListData(payload.data, status).items,
	);
}

/** 读取当前内部患者的脱敏预约历史摘要。 */
export type AppointmentRecordQueryWindow = "history" | "missed";

/**
 * 预约记录窗口是页面业务语义，不是可以随意降级的字符串参数。
 *
 * TypeScript 的联合类型只在编译期存在；微信事件、页面参数或旧缓存仍
 * 可能在运行时传入未知值。未知值不能静默落入 `history` 分支，否则“爽约
 * 记录”可能被错误查询成普通挂号历史，页面看似有数据但业务含义已经错了。
 */
function isAppointmentRecordQueryWindow(
	value: unknown,
): value is AppointmentRecordQueryWindow {
	return value === "history" || value === "missed";
}

export type AppointmentRecordQuery = {
	patientId: string;
	startDate: string;
	endDate: string;
};

/**
 * 生成预约记录的唯一查询契约。
 *
 * “我的挂号”和“爽约记录”虽然复用同一个 API，但不是同一个时间窗口：
 * history 必须覆盖中国标准时间前后各 90 天，missed 只能覆盖过去 90 天。
 * 把窗口选择集中在这里，页面就不能因为复制代码或切换标签而把未来预约
 * 错误排除，或把未来预约拿来判断爽约。患者 ID 也必须在发请求前经过同一
 * 个内部 opaque 输入校验；小程序不会在这里接触 Provider 患者号。
 */
export function createAppointmentRecordQuery(
	patientId: string,
	now = new Date(),
	window: AppointmentRecordQueryWindow = "history",
): AppointmentRecordQuery {
	if (!isAppointmentRecordQueryWindow(window)) {
		// 这里必须在生成日期窗口和发起网络请求前失败；不能把未知窗口
		// 当成 history，也不能让服务端或 Provider 猜测调用方意图。
		throw new ApiError("预约记录查询条件不合法", {
			code: "appointment-record-query-invalid",
		});
	}
	const range =
		window === "missed"
			? createPastDateRange(
					DASHBOARD_DATE_RANGE_DAYS.missedAppointmentsPast,
					now,
				)
			: createAppointmentRecordDateRange(now);
	return {
		patientId: requirePatientId(patientId),
		...range,
	};
}

export function loadAppointmentRecords(
	patientId: string,
	now = new Date(),
	window: AppointmentRecordQueryWindow = "history",
): Promise<Array<AppointmentRecord>> {
	return requestAppointmentRecords(
		createAppointmentRecordQuery(patientId, now, window),
	).then((payload) => requireAppointmentRecordListData(payload.data).items);
}

/** 读取当前内部患者的 LIS/PACS/ECG 报告目录摘要。 */
export function loadReports(
	patientId: string,
	now = new Date(),
): Promise<ReportListResponse["data"]> {
	const range: ReportQuery = {
		patientId: requirePatientId(patientId),
		...createPastDateRange(DASHBOARD_DATE_RANGE_DAYS.reports, now),
	};
	// 报告响应在 API client 边界已经完成 canonical 校验和白名单投影；
	// 这里仅取同一份已验证读模型，不再使用泛型把未知 JSON 当作临床事实。
	return requestReports(range).then((payload) => payload.data);
}
