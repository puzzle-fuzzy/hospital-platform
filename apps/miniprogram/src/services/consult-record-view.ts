import type { AppointmentRecord } from "../types";

/**
 * 就诊页中已经可以安全展示的两个预约历史标签。
 *
 * `today` 不是这里的一个筛选结果：它依赖实时就诊事件，不能把当天的
 * 预约摘要伪装成叫号、排队或就诊动态。因此当天记录会从未来/历史两个
 * 只读列表中明确排除，继续交给实时 contract 的状态壳。
 */
export type ConsultRecordTab = "upcoming" | "history";

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
