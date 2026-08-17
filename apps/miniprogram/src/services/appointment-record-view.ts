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
 * 旧端“在线挂号”通过 provider 的 `requestChannel=3` 查询，
 * “全部挂号”则使用另一个渠道值；但新公共 AppointmentRecord 没有渠道字段，
 * 当前也没有证据证明旧端的 3/4 仍代表同样的业务范围。这里不能在小程序内
 * 猜测渠道、把标签点击重新翻译成 provider 参数，或把一次只读响应伪装成两
 * 个独立渠道结果。因此当前“在线挂号”只排除服务端明确归一化的 `cancelled`，
 * “全部挂号”展示本次已取得的完整读模型；这保持旧端可见结构，同时明确不
 * 冒充旧渠道语义。只有 provider 合同冻结并将渠道归一化字段加入公共 contract
 * 后，才能把两个标签改成真正不同的业务筛选。
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
