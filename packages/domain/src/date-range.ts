/**
 * 将 API 的日期筛选解析为 UTC 零点时间戳。
 *
 * 仅使用 Date.parse 会把 `2026-02-30` 归一化为 3 月日期，导致非法日历
 * 输入穿过边界并进入 provider 请求；这里通过 ISO 字符串回读确认日期真实存在。
 */
export function parseIsoCalendarDate(value: string): number | undefined {
	if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return undefined;

	const date = new Date(`${value}T00:00:00.000Z`);
	return Number.isFinite(date.getTime()) &&
		date.toISOString().slice(0, 10) === value
		? date.getTime()
		: undefined;
}
