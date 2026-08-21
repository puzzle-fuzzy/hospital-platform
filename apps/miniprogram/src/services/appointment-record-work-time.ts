/**
 * 小程序运行时使用的预约记录时间校验。
 *
 * 微信开发者工具加载的是 dist/ 下的 CommonJS 运行包，不会解析 pnpm
 * workspace 的裸模块名（例如 @hospital/contracts）。因此这里保留一份
 * 无第三方依赖的运行时实现，避免把服务端/共享契约包的 Node 依赖误带入
 * 小程序。对应的共享契约行为由 appointment-record-work-time.test.ts 做
 * 代表性一致性校验；页面仍然只消费这个本地运行时模块。
 */

/** 预约记录公开给页面的时间点或时间段格式。 */
export const APPOINTMENT_RECORD_WORK_TIME_PATTERN =
	"^(?:[01]\\d|2[0-3]):[0-5]\\d(?:-(?:[01]\\d|2[0-3]):[0-5]\\d)?$";

/**
 * 判断预约记录的就诊时间是否是可安全展示的时间点/时间段。
 *
 * 不能只校验正则：例如 15:00-09:00 形式上匹配，但结束时间早于开始
 * 时间，继续展示会让“我的挂号”页面产生错误的就诊顺序。
 */
export function isAppointmentRecordWorkTime(value: unknown): value is string {
	if (typeof value !== "string") return false;
	const match =
		/^(?:[01]\d|2[0-3]):[0-5]\d(?:-(?:[01]\d|2[0-3]):[0-5]\d)?$/.exec(value);
	if (!match) return false;

	const [start, end] = value.split("-");
	if (!start || !end) return true;

	const toMinutes = (clock: string): number =>
		Number(clock.slice(0, 2)) * 60 + Number(clock.slice(3, 5));
	return toMinutes(end) >= toMinutes(start);
}
