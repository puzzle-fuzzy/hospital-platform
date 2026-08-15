import {
	ApiError,
	request,
	requestAppointmentDepartments,
	requestAppointmentRecords,
	requestAppointmentSchedules,
	requestReports,
	requestWithSession,
	syncPatients,
} from "./api-client";

/**
 * 首页只读工作台使用的时间窗口。
 *
 * 这些窗口是产品边界，不是 provider 参数。真正的 provider 日期和字段
 * 仍由服务端 adapter 负责编排，避免小程序逐渐变成外部系统的薄代理。
 */
export const DASHBOARD_DATE_RANGE_DAYS = Object.freeze({
	appointmentDirectory: 7,
	appointmentRecords: 90,
	reports: 30,
});

/** @param {number} value */
function padDatePart(value) {
	return String(value).padStart(2, "0");
}

/**
 * 将本地日期格式化为平台公开 contract 使用的 YYYY-MM-DD。
 * 不使用 toISOString，避免 UTC 偏移导致真机在午夜前后跨天。
 * @param {Date} value
 */
export function formatPlatformDate(value) {
	return [
		value.getFullYear(),
		padDatePart(value.getMonth() + 1),
		padDatePart(value.getDate()),
	].join("-");
}

/**
 * 创建以今天为结束日的查询窗口；days 必须来自上面的产品常量。
 * @param {number} days
 * @param {Date} [now]
 */
export function createPastDateRange(days, now = new Date()) {
	const end = new Date(now);
	const start = new Date(now);
	start.setDate(start.getDate() - days);
	return {
		startDate: formatPlatformDate(start),
		endDate: formatPlatformDate(end),
	};
}

/**
 * 创建从今天开始的未来查询窗口。
 * @param {number} days
 * @param {Date} [now]
 */
export function createUpcomingDateRange(days, now = new Date()) {
	const start = new Date(now);
	const end = new Date(now);
	end.setDate(end.getDate() + days);
	return {
		startDate: formatPlatformDate(start),
		endDate: formatPlatformDate(end),
	};
}

/**
 * 只允许使用服务端返回的内部 patientId。
 * 页面层也会做一次校验，但服务层再次设边界，避免未来新增页面时绕过
 * 当前患者选择逻辑，把 provider 患者号或空值拼进平台 URL。
 * @param {unknown} patientId
 */
function requirePatientId(patientId) {
	if (typeof patientId !== "string" || !patientId) {
		throw new ApiError("请先登录并选择就诊人", {
			code: "patient-selection-required",
		});
	}
	return patientId;
}

/** 健康检查只证明 API 进程响应，不把 ready 误显示为可用。 */
export function loadHealth() {
	return request({ url: "/health/live" });
}

/** 读取当前会话归属的脱敏患者读模型。 */
export function loadPatients() {
	return requestWithSession({ url: "/api/v1/patients" }).then(
		(payload) => payload?.data?.items || [],
	);
}

/** 请求服务端从已认证身份同步患者，不在小程序侧拼 provider 字段。 */
/** @param {string} idempotencyKey */
export function syncPatientsFromHospital(idempotencyKey) {
	return syncPatients(idempotencyKey).then(
		(payload) => payload?.data?.items || [],
	);
}

/**
 * 并行读取预约科室和排班目录，返回页面可以直接消费的读模型。
 * 写入、锁号、费用和支付仍然不属于这个服务。
 */
export function loadAppointmentDirectory(now = new Date()) {
	const range = createUpcomingDateRange(
		DASHBOARD_DATE_RANGE_DAYS.appointmentDirectory,
		now,
	);
	return Promise.all([
		requestAppointmentDepartments(),
		requestAppointmentSchedules(range),
	]).then(([departmentPayload, schedulePayload]) => ({
		departments: departmentPayload?.data?.items || [],
		schedules: schedulePayload?.data?.items || [],
	}));
}

/** 读取当前内部患者的脱敏预约历史摘要。 */
/** @param {string} patientId @param {Date} [now] */
export function loadAppointmentRecords(patientId, now = new Date()) {
	const range = createPastDateRange(
		DASHBOARD_DATE_RANGE_DAYS.appointmentRecords,
		now,
	);
	return requestAppointmentRecords({
		patientId: requirePatientId(patientId),
		...range,
	}).then((payload) => payload?.data?.items || []);
}

/** 读取当前内部患者的 LIS/PACS/ECG 报告目录摘要。 */
/** @param {string} patientId @param {Date} [now] */
export function loadReports(patientId, now = new Date()) {
	const range = createPastDateRange(DASHBOARD_DATE_RANGE_DAYS.reports, now);
	return requestReports({
		patientId: requirePatientId(patientId),
		...range,
	}).then((payload) => payload?.data?.items || []);
}
