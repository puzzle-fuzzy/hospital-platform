import type { AppointmentSchedule } from "../types";

/** 预约目录日期标签的中文星期文案；日期事实仍保留服务端的 YYYY-MM-DD。 */
const WEEKDAY_LABELS = [
	"周日",
	"周一",
	"周二",
	"周三",
	"周四",
	"周五",
	"周六",
] as const;

export type AppointmentDateGroup = {
	workDate: string;
	label: string;
	count: number;
};

/**
 * 把医院业务日历转换成旧端右栏的短标签。
 *
 * `workDate` 是纯日期而不是带时区的瞬时点；固定用 UTC 作为不会发生偏移
 * 的日历容器，避免用户设备时区把医院日期显示成前一天或后一天。输入在
 * API client 已经通过 contract 校验，但这里仍保留非法日期的原文回退，
 * 防止未来其它页面直接调用时悄悄制造错误日期文案。
 */
export function formatAppointmentDateLabel(value: string): string {
	if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
	const date = new Date(`${value}T00:00:00.000Z`);
	if (
		Number.isNaN(date.getTime()) ||
		date.toISOString().slice(0, 10) !== value
	) {
		return value;
	}
	const weekday = WEEKDAY_LABELS[date.getUTCDay()] ?? "";
	return `${date.getUTCMonth() + 1}月${date.getUTCDate()}日 ${weekday}`;
}

/**
 * 按医院工作日聚合排班。
 *
 * 这里仅做展示层分组，不改变 Provider 返回顺序，也不把日期分组当成
 * 服务端分页。排班的完整性、日期窗口和科室归属必须在 API/service 层
 * 校验后才能进入本函数。
 */
export function groupAppointmentSchedules(
	schedules: readonly Pick<AppointmentSchedule, "workDate">[],
): AppointmentDateGroup[] {
	const counts = new Map<string, number>();
	for (const schedule of schedules) {
		counts.set(schedule.workDate, (counts.get(schedule.workDate) ?? 0) + 1);
	}
	return [...counts.entries()]
		.sort(([first], [second]) => first.localeCompare(second))
		.map(([workDate, count]) => ({
			workDate,
			label: formatAppointmentDateLabel(workDate),
			count,
		}));
}

/**
 * 取得当前日期的本地渲染窗口。
 *
 * 页面“加载更多”只扩大已经取得并校验过的读模型；非法或非正的窗口值
 * 统一收敛为空窗口，不能让 `Array.prototype.slice` 的负数语义意外展示
 * 末尾排班。
 */
export function visibleAppointmentSchedules(
	schedules: readonly AppointmentSchedule[],
	selectedDate: string,
	visibleCount: number,
): AppointmentSchedule[] {
	const boundedCount =
		Number.isSafeInteger(visibleCount) && visibleCount > 0 ? visibleCount : 0;
	return schedules
		.filter((schedule) => schedule.workDate === selectedDate)
		.slice(0, boundedCount);
}
