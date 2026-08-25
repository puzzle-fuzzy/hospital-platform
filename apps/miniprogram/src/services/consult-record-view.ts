import type { AppointmentRecord } from "../types";

/**
 * 就诊页中已经可以安全展示的两个预约历史标签。
 *
 * `today` 不是这里的一个筛选结果：它依赖实时就诊事件，不能把当天的
 * 预约摘要伪装成叫号、排队或就诊动态。因此当天记录会从未来/历史两个
 * 只读列表中明确排除，继续交给实时 contract 的状态壳。
 */
export type ConsultRecordTab = "upcoming" | "history";

/** 就诊页实际可点击的三个标签；today 仍然只是实时状态壳。 */
export type ConsultPageTab = "today" | ConsultRecordTab;

export type ConsultRecordWindow<T extends AppointmentRecord> = {
	/** 当前标签下已经允许渲染的记录数量。 */
	visibleRecords: T[];
	/** 当前标签下本次读取到的全部记录数量。 */
	totalRecords: number;
	/** 是否还有已经读取但尚未展开的记录。 */
	hasMoreRecords: boolean;
};

/**
 * 按医院业务日历把预约摘要分为未来和历史。
 *
 * `workDate` 是服务端已经校验过的自然日，不是带时区的瞬时点；调用方
 * 必须传入同一中国标准时间自然日，不能用设备本地日期直接比较。当天
 * 记录不进入任何一组，避免“预约成功”被页面误读为“已经就诊/正在叫号”。
 */
export function filterConsultRecords<T extends AppointmentRecord>(
	records: readonly T[],
	today: string,
	tab: ConsultRecordTab,
): T[] {
	if (tab !== "upcoming" && tab !== "history") return [];

	return records.filter((record) => {
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
	if (tab === "today" || !businessDate) {
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
