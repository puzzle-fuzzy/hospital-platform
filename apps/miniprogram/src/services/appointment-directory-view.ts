import type { AppointmentDoctorCard, AppointmentSchedule } from "../types";

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

/** 蓝狐“按日期挂号”横向日期条的安全展示模型。 */
export type AppointmentDateStripItem = {
	workDate: string;
	dateLabel: string;
	weekdayLabel: string;
};

function parseCalendarDate(value: string): Date | undefined {
	if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return undefined;
	const date = new Date(`${value}T00:00:00.000Z`);
	return Number.isNaN(date.getTime()) ||
		date.toISOString().slice(0, 10) !== value
		? undefined
		: date;
}

/**
 * 生成旧项目“按日期挂号”的六日横向日期条。
 *
 * workDate 是医院日历自然日，因此固定使用 UTC 进位；这不会把中国时区
 * 的午夜切换成前一天。maxDate 仅用于产品可预约上限，并不扩大 API 查询。
 */
export function buildAppointmentDateStrip(
	startDate: string,
	length = 6,
	maxDate = "",
): AppointmentDateStripItem[] {
	if (!Number.isSafeInteger(length) || length <= 0) return [];
	const start = parseCalendarDate(startDate);
	const maximum = maxDate ? parseCalendarDate(maxDate) : undefined;
	if (!start || (maxDate && !maximum) || (maximum && start > maximum))
		return [];

	const items: AppointmentDateStripItem[] = [];
	for (let index = 0; index < length; index += 1) {
		const date = new Date(start.getTime());
		date.setUTCDate(date.getUTCDate() + index);
		if (maximum && date > maximum) break;
		const workDate = date.toISOString().slice(0, 10);
		items.push({
			workDate,
			dateLabel: `${String(date.getUTCMonth() + 1).padStart(2, "0")}-${String(
				date.getUTCDate(),
			).padStart(2, "0")}`,
			weekdayLabel: WEEKDAY_LABELS[date.getUTCDay()] ?? "",
		});
	}
	return items;
}

/**
 * 只从当前已校验的排班中收窄某位医生的展示窗口。
 *
 * 医生 ID 为空时代表“全部医生”。这只是本地读模型筛选，不能把医生 ID
 * 当成 Provider 查询条件或预约授权；实际排班请求仍由页面按科室发起。
 */
export function filterAppointmentSchedulesByDoctor(
	schedules: readonly AppointmentSchedule[],
	doctorId = "",
): AppointmentSchedule[] {
	if (!doctorId) return [...schedules];
	return schedules.filter((schedule) => schedule.doctorId === doctorId);
}

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
	doctorId = "",
): AppointmentDateGroup[] {
	const counts = new Map<string, number>();
	for (const schedule of schedules) {
		if (doctorId && "doctorId" in schedule && schedule.doctorId !== doctorId) {
			continue;
		}
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
	doctorId = "",
): AppointmentSchedule[] {
	const boundedCount =
		Number.isSafeInteger(visibleCount) && visibleCount > 0 ? visibleCount : 0;
	return filterAppointmentSchedulesByDoctor(schedules, doctorId)
		.filter((schedule) => schedule.workDate === selectedDate)
		.slice(0, boundedCount);
}

/**
 * 将当前科室已读取的排班聚合成旧端“按医生挂号”的卡片。
 *
 * 卡片只使用医生、日期、排班数量、余号和已确认的医生照片字段；
 * 同一医生同日的多个班次合并展示，照片取该医生排班中首个非空 URL，
 * 不携带职称、擅长、费用或关注关系。
 */
export function groupAppointmentDoctorCards(
	schedules: readonly AppointmentSchedule[],
): AppointmentDoctorCard[] {
	type MutableDoctorCard = {
		doctorId: string;
		doctorName: string;
		doctorPhotoUrl?: string;
		scheduleCount: number;
		availableSlots: number;
		dateSlots: Map<string, number>;
	};

	const cardsByDoctor = new Map<string, MutableDoctorCard>();
	for (const schedule of schedules) {
		const card = cardsByDoctor.get(schedule.doctorId);
		if (card) {
			card.scheduleCount += 1;
			card.availableSlots += schedule.availableSlots;
			card.dateSlots.set(
				schedule.workDate,
				(card.dateSlots.get(schedule.workDate) ?? 0) + schedule.availableSlots,
			);
			// 建卡时无图的医生，用后续排班中首个非空照片补齐；已有照片不覆盖。
			if (!card.doctorPhotoUrl && schedule.doctorPhotoUrl) {
				card.doctorPhotoUrl = schedule.doctorPhotoUrl;
			}
			continue;
		}
		cardsByDoctor.set(schedule.doctorId, {
			doctorId: schedule.doctorId,
			doctorName: schedule.doctorName,
			...(schedule.doctorPhotoUrl
				? { doctorPhotoUrl: schedule.doctorPhotoUrl }
				: {}),
			scheduleCount: 1,
			availableSlots: schedule.availableSlots,
			dateSlots: new Map([[schedule.workDate, schedule.availableSlots]]),
		});
	}

	return [...cardsByDoctor.values()].map((card) => ({
		doctorId: card.doctorId,
		doctorName: card.doctorName,
		...(card.doctorPhotoUrl ? { doctorPhotoUrl: card.doctorPhotoUrl } : {}),
		avatarLabel: card.doctorName.slice(0, 1),
		scheduleCount: card.scheduleCount,
		availableSlots: card.availableSlots,
		dates: [...card.dateSlots.entries()]
			.sort(([first], [second]) => first.localeCompare(second))
			.map(([workDate, availableSlots]) => ({
				workDate,
				label: formatAppointmentDateLabel(workDate),
				availableSlots,
			})),
	}));
}
