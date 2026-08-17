import type { AppointmentRecord, AppointmentRecordView } from "../types";

/**
 * 预约历史的状态文案必须由一个展示边界统一维护。
 *
 * 服务端已经把 Provider 数字状态归一化为稳定英文枚举；小程序只能在
 * 这个边界把枚举翻译成中文，不能在页面里重新解释 Provider 数字，也不能
 * 把 unknown 猜成已预约、已完成或爽约。预约历史页和爽约筛选页共用这里，
 * 避免两个页面对同一个状态出现不同文案。
 */
export const APPOINTMENT_RECORD_STATUS_LABELS = Object.freeze({
	scheduled: "已预约",
	cancelled: "已取消",
	completed: "已完成",
	missed: "已爽约",
	stopped: "停诊",
	substituted: "替诊",
	registered: "已登记",
	unknown: "状态未知",
} as const);

/** 只有服务端明确归一化为 missed 的记录才属于爽约，不接受客户端猜测。 */
export function isMissedAppointment(record: AppointmentRecord): boolean {
	return record.status === "missed";
}

/**
 * 旧端“在线挂号”只排除已取消记录；新端不能重新解释 provider 数字状态，
 * 因此沿用服务端已经归一化的 `cancelled` 枚举作为唯一过滤边界。
 */
export function isOnlineAppointmentRecord(record: AppointmentRecord): boolean {
	return record.status !== "cancelled";
}

/** 标签切换只影响当前已取得的记录，不改变日期窗口或新增 Provider 请求。 */
export function filterAppointmentRecords<T extends AppointmentRecord>(
	records: readonly T[],
	tab: "online" | "all",
): T[] {
	return tab === "all"
		? [...records]
		: records.filter(isOnlineAppointmentRecord);
}

/**
 * 将服务端预约摘要转换为 WXML 渲染模型。
 *
 * `viewKey` 只用于当前响应批次的 WXML diff。由于只读摘要可能没有稳定的
 * 公共预约 ID，索引不能被当作详情、取消、支付或任何写入业务引用。
 */
export function toAppointmentRecordView(
	record: AppointmentRecord,
	index: number,
	prefix: "appointment-record" | "missed-appointment-record",
): AppointmentRecordView {
	return {
		...record,
		viewKey: `${prefix}-${index}`,
		statusLabel: APPOINTMENT_RECORD_STATUS_LABELS[record.status],
		statusClass: `record-status-${record.status}`,
	};
}
