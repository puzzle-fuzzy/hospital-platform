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
 * 当前服务端预约历史查询固定使用已经确认的微信渠道 `requestChannel=3`。
 * 旧端的在线标签还会排除服务端明确归一化的 `cancelled`，这属于已观察到的
 * 展示规则，不是把“取消”误当作渠道字段。新公共记录没有渠道字段，因此
 * 小程序不能把同一批 `3` 渠道结果伪装成“全部挂号”；全部渠道必须等服务端
 * 取得并冻结 `requestChannel=4` 的独立查询 contract 后再开放。
 */
export function isOnlineAppointmentRecord(record: AppointmentRecord): boolean {
	return record.status !== "cancelled";
}

/** 当前只有在线渠道可用；全部渠道不能用本地记录拼接或状态推导。 */
export function isAppointmentRecordTabAvailable(
	tab: "online" | "all",
): boolean {
	return tab === "online";
}

/**
 * 标签切换只影响当前已取得的在线读模型。
 *
 * `all` 返回空数组只是防御性边界：页面会在切换前拦截该标签并提示迁移中，
 * 不能让未来新增调用方误把在线记录当成全部记录。真正的全部查询必须在
 * 服务端新增独立渠道请求和 owner-scoped contract 后实现。
 */
export function filterAppointmentRecords<T extends AppointmentRecord>(
	records: readonly T[],
	tab: "online" | "all",
): T[] {
	if (!isAppointmentRecordTabAvailable(tab)) return [];
	return records.filter(isOnlineAppointmentRecord);
}

/**
 * 将公共读模型中的第一个时钟片段翻译成旧端的上午/下午/晚上标签。
 *
 * 这只是患者端排版辅助，不会改变服务端 `workTime`，也不会根据缺失的
 * 时间猜测完整时段；例如没有明确小时值时保持空字符串，让页面只展示日期。
 */
function toPeriodLabel(workTime?: string): string {
	const hourText = workTime?.match(/^(\d{2})/)?.[1];
	if (!hourText) return "";

	const hour = Number(hourText);
	if (!Number.isInteger(hour) || hour > 23) return "";
	if (hour < 12) return "上午";
	if (hour < 18) return "下午";
	return "晚上";
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
		periodLabel: toPeriodLabel(record.workTime),
	};
}
