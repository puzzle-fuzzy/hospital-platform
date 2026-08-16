import type {
	AppointmentDepartment,
	AppointmentRecord,
	AppointmentSchedule,
	AppointmentScheduleQuery,
	HealthResponse,
	OutpatientPaymentRecord,
	Patient,
	ReportListResponse,
	ReportQuery,
} from "../types";
import {
	ApiError,
	request,
	requestAppointmentDepartments,
	requestAppointmentRecords,
	requestAppointmentSchedules,
	requestOutpatientPaymentRecords,
	requestReports,
	requestWithSession,
	syncPatients,
} from "./api-client";

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

/** 只允许使用服务端返回的内部 patientId。 */
function requirePatientId(patientId: unknown): string {
	if (typeof patientId !== "string" || !patientId) {
		throw new ApiError("请先登录并选择就诊人", {
			code: "patient-selection-required",
		});
	}
	return patientId;
}

/** 健康检查只证明 API 进程响应，不把 ready 误显示为可用。 */
export function loadHealth(): Promise<HealthResponse> {
	return request<HealthResponse>({ url: "/health/live" });
}

/** 读取当前会话归属的脱敏患者读模型。 */
export function loadPatients(): Promise<Array<Patient>> {
	return requestWithSession<{ data: { items: Array<Patient> } }>({
		url: "/patients",
	}).then((payload) => payload.data.items);
}

/** 请求服务端从已认证身份同步患者，不在小程序侧拼 provider 字段。 */
export function syncPatientsFromHospital(
	idempotencyKey: string,
): Promise<Array<Patient>> {
	return syncPatients(idempotencyKey).then((payload) => payload.data.items);
}

/** 并行读取预约科室和排班目录。 */
export function loadAppointmentDirectory(now = new Date()): Promise<{
	departments: Array<AppointmentDepartment>;
	schedules: Array<AppointmentSchedule>;
}> {
	const range: AppointmentScheduleQuery = createUpcomingDateRange(
		DASHBOARD_DATE_RANGE_DAYS.appointmentDirectory,
		now,
	);
	return Promise.all([
		requestAppointmentDepartments(),
		requestAppointmentSchedules(range),
	]).then(([departmentPayload, schedulePayload]) => ({
		departments: departmentPayload.data.items,
		schedules: schedulePayload.data.items,
	}));
}

/**
 * 只读取预约一级科室。
 *
 * 预约页采用“两列级联”布局后，排班必须在选中科室后再请求；不能为了
 * 绘制左侧菜单把未来窗口内的全部排班一次性搬到小程序内存和渲染树。
 */
export function loadAppointmentDepartments(): Promise<
	Array<AppointmentDepartment>
> {
	return requestAppointmentDepartments().then((payload) => payload.data.items);
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
	return requestAppointmentSchedules({
		departmentId,
		...createUpcomingDateRange(
			DASHBOARD_DATE_RANGE_DAYS.appointmentDirectory,
			now,
		),
	}).then((payload) => payload.data.items);
}

/** 读取门诊费用读模型，日期窗口由服务端统一限制。 */
export function loadOutpatientPaymentRecords(
	patientId: string,
	status: "unpaid" | "paid",
): Promise<Array<OutpatientPaymentRecord>> {
	return requestOutpatientPaymentRecords({ patientId, status }).then(
		(payload) => payload.data.items,
	);
}

/** 读取当前内部患者的脱敏预约历史摘要。 */
export function loadAppointmentRecords(
	patientId: string,
	now = new Date(),
	window: "history" | "missed" = "history",
): Promise<Array<AppointmentRecord>> {
	// “我的挂号”和“爽约记录”共享 provider 查询，但业务时间窗口不同：
	// 前者不能漏掉未来预约，后者不能查询未来日期并把未知事实误当爽约。
	const range =
		window === "missed"
			? createPastDateRange(
					DASHBOARD_DATE_RANGE_DAYS.missedAppointmentsPast,
					now,
				)
			: createAppointmentRecordDateRange(now);
	return requestAppointmentRecords({
		patientId: requirePatientId(patientId),
		...range,
	}).then((payload) => payload.data.items);
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
	return requestReports(range).then((payload) => payload.data);
}
