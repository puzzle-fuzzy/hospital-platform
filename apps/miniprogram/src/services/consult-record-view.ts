import type { AppointmentRecord } from "../types";

/**
 * 就诊页的三个展示窗口都只读取预约摘要；`today` 不等于实时就诊。
 *
 * 当天预约可以安全展示日期、科室和服务端已确认的预约状态，但不能由
 * 这些静态字段推导叫号、排队、候诊或“已经就诊”。实时事件仍由独立
 * contract 负责，因此页面会在记录卡片下方明确保留关闭提示。
 */
export type ConsultRecordTab = "today" | "upcoming" | "history";

/** 就诊页实际可点击的三个标签。 */
export type ConsultPageTab = ConsultRecordTab;

export type ConsultRecordWindow<T extends AppointmentRecord> = {
	/** 当前标签下已经允许渲染的记录数量。 */
	visibleRecords: T[];
	/** 当前标签下本次读取到的全部记录数量。 */
	totalRecords: number;
	/** 是否还有已经读取但尚未展开的记录。 */
	hasMoreRecords: boolean;
};

/**
 * 按医院业务日历把预约摘要分为今日、未来和历史。
 *
 * `workDate` 是服务端已经校验过的自然日，不是带时区的瞬时点；调用方
 * 必须传入同一中国标准时间自然日，不能用设备本地日期直接比较。当天
 * 记录只作为预约摘要进入 `today`，不改变服务端返回的预约状态，也不
 * 生成任何实时叫号或排队结论。
 */
export function filterConsultRecords<T extends AppointmentRecord>(
	records: readonly T[],
	today: string,
	tab: ConsultRecordTab,
): T[] {
	if (tab !== "today" && tab !== "upcoming" && tab !== "history") return [];

	return records.filter((record) => {
		if (tab === "today") return record.workDate === today;
		if (record.workDate === today) return false;
		return tab === "upcoming"
			? record.workDate > today
			: record.workDate < today;
	});
}

/**
 * 按固定的业务日快照生成就诊页的展示窗口。
 *
 * 页面切换标签或加载更多时必须继续传入同一个 `businessDate`，不能在
 * 这里或调用方重新读取当前时间。这样即使页面跨过中国标准时间零点，
 * 同一轮服务端查询结果也不会在未来/历史两个标签之间发生漂移；用户
 * 主动刷新后才会建立新的业务日快照。
 */
export function getConsultRecordWindow<T extends AppointmentRecord>(
	records: readonly T[],
	tab: ConsultPageTab,
	businessDate: string,
	visibleCount: number,
): ConsultRecordWindow<T> {
	if (!businessDate) {
		return { visibleRecords: [], totalRecords: 0, hasMoreRecords: false };
	}

	const filteredRecords = filterConsultRecords(records, businessDate, tab);
	const safeVisibleCount = Number.isSafeInteger(visibleCount)
		? Math.max(0, visibleCount)
		: 0;

	return {
		visibleRecords: filteredRecords.slice(0, safeVisibleCount),
		totalRecords: filteredRecords.length,
		hasMoreRecords: filteredRecords.length > safeVisibleCount,
	};
}
