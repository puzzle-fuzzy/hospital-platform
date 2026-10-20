const shanghaiTime = new Intl.DateTimeFormat("zh-CN", {
	timeZone: "Asia/Shanghai",
	year: "numeric",
	month: "2-digit",
	day: "2-digit",
	hour: "2-digit",
	minute: "2-digit",
	second: "2-digit",
	hourCycle: "h23",
});

/** API 时间必须携带明确时区；无时区的数据库原文不能由浏览器猜测。 */
export function formatAdminTime(value: string): string {
	if (
		!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/.test(
			value,
		)
	) {
		return "时间待核实";
	}
	const date = new Date(value);
	return Number.isNaN(date.getTime())
		? "时间待核实"
		: shanghaiTime.format(date);
}
