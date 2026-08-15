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
	appointmentRecords: 90,
	reports: 30,
});

function padDatePart(value: number): string {
	return String(value).padStart(2, "0");
}

/** 将本地日期格式化为平台公开 contract 使用的 YYYY-MM-DD。 */
export function formatPlatformDate(value: Date): string {
	return [
		value.getFullYear(),
		padDatePart(value.getMonth() + 1),
		padDatePart(value.getDate()),
	].join("-");
}

/** 创建以今天为结束日的查询窗口。 */
export function createPastDateRange(
	days: number,
	now = new Date(),
): { startDate: string; endDate: string } {
	const end = new Date(now);
	const start = new Date(now);
	start.setDate(start.getDate() - days);
	return {
		startDate: formatPlatformDate(start),
		endDate: formatPlatformDate(end),
	};
}

/** 创建从今天开始的未来查询窗口。 */
export function createUpcomingDateRange(
	days: number,
	now = new Date(),
): { startDate: string; endDate: string } {
	const start = new Date(now);
	const end = new Date(now);
	end.setDate(end.getDate() + days);
	return {
		startDate: formatPlatformDate(start),
		endDate: formatPlatformDate(end),
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
): Promise<Array<AppointmentRecord>> {
	const range = createPastDateRange(
		DASHBOARD_DATE_RANGE_DAYS.appointmentRecords,
		now,
	);
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
