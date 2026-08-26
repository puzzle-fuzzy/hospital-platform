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

/**
 * 解析带显式时区的 ISO 8601 时间点，并拒绝 JavaScript 自动进位的非法日期。
 *
 * `Date.parse` 对部分输入会把 2 月 30 日变成 3 月的日期；如果这种时间
 * 进入发布窗口、短期会话或命令轨迹，业务比较结果就会被静默改变。这里
 * 先校验日期、时分秒和偏移的组成，再交给运行时计算绝对时间戳。调用方
 * 可以用 `undefined` 统一映射为各自领域的稳定错误，不把原始时间写入日志。
 */
export function parseStrictIsoInstant(value: string): number | undefined {
	const match =
		/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,3}))?(Z|[+-]\d{2}:?\d{2})$/u.exec(
			value,
		);
	if (!match) return undefined;

	const calendarDate = `${match[1]}-${match[2]}-${match[3]}`;
	if (parseIsoCalendarDate(calendarDate) === undefined) return undefined;

	const hour = Number(match[4]);
	const minute = Number(match[5]);
	const second = Number(match[6]);
	if (hour > 23 || minute > 59 || second > 59) return undefined;

	const timezone = match[8];
	if (timezone === undefined) return undefined;
	if (timezone !== "Z") {
		const offset = timezone.slice(1).replace(":", "");
		const offsetHour = Number(offset.slice(0, 2));
		const offsetMinute = Number(offset.slice(2, 4));
		if (offsetHour > 23 || offsetMinute > 59) return undefined;
	}

	const timestamp = Date.parse(value);
	return Number.isFinite(timestamp) ? timestamp : undefined;
}
