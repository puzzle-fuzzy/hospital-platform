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
 * 在线标签使用服务端的微信渠道读模型，并排除明确取消的记录；全部标签
 * 使用服务端独立查询的历史读模型，保留已取消记录。两个列表来自不同的
 * Provider 请求，不能在客户端把在线结果复制成全部结果。
 */
export function isOnlineAppointmentRecord(record: AppointmentRecord): boolean {
	// dashboard-service 已经做过一次响应重投影，但页面展示边界不能把
	// TypeScript 联合类型当成运行时事实。若未来有旧缓存、回放数据或新
	// 调用方绕过该校验，未知状态不能因为“不是 cancelled”就进入在线列表。
	// `unknown` 是已确认的公共枚举，仍然保留并以“状态未知”展示；真正
	// 不在枚举中的值必须在这里 fail-closed。
	return (
		Object.hasOwn(APPOINTMENT_RECORD_STATUS_LABELS, record.status) &&
		record.status !== "cancelled"
	);
}

/** 服务端已为在线和全部标签分别冻结只读查询语义。 */
export function isAppointmentRecordTabAvailable(
	tab: "online" | "all",
): boolean {
	return tab === "online" || tab === "all";
}

/**
 * 标签切换只影响当前已取得的对应渠道读模型。
 *
 * 全部查询由页面切换时重新请求服务端；
 * 不能让未来新增调用方误把在线记录当成全部记录；已取得的结果只在同一
 * 范围内做本地窗口分页，不能把在线结果在此处拼接成全量历史。
 */
export function filterAppointmentRecords<T extends AppointmentRecord>(
	records: readonly T[],
	tab: "online" | "all",
): T[] {
	if (!isAppointmentRecordTabAvailable(tab)) return [];
	if (tab === "all") return [...records];
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
 * `viewKey` 只用于当前响应批次的 WXML diff 和事件回查。由于只读摘要没有
 * 稳定的公共预约 ID，页面会把自己的请求令牌作为渲染批次号传入；这样刷新
 * 患者或重新查询后，即使旧 WXML 事件晚到，也不会按相同数组索引命中新记录。
 * 这个 key 仍然不是详情、取消、支付或任何写入业务引用。
 */
export function toAppointmentRecordView(
	record: AppointmentRecord,
	index: number,
	prefix: "appointment-record" | "missed-appointment-record" | "consult-record",
	renderGeneration = 0,
): AppointmentRecordView {
	return {
		...record,
		viewKey: `${prefix}-${renderGeneration}-${index}`,
		statusLabel: APPOINTMENT_RECORD_STATUS_LABELS[record.status],
		statusClass: `record-status-${record.status}`,
		periodLabel: toPeriodLabel(record.workTime),
	};
}
