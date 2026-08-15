import { ApiError } from "../../services/api-client";
import {
	loadAppointmentDepartments,
	loadAppointmentSchedules,
} from "../../services/dashboard-service";
import type {
	AppointmentDirectoryPageData,
	AppointmentSchedule,
} from "../../types";

/** 当前右侧最多绘制的号源数量，继续加载由用户明确触发。 */
const SCHEDULE_PAGE_SIZE = 12;

type AppointmentDirectoryPageMethods = {
	loadDirectory(): Promise<void>;
	loadDepartmentSchedules(departmentId: string): Promise<void>;
	onDepartmentTap(event: WechatMiniprogram.TouchEvent): void;
	onDateTap(event: WechatMiniprogram.TouchEvent): void;
	onLoadMore(): void;
	onScheduleTap(): void;
	onPullDownRefresh(): void;
	showError(error: unknown, fallback: string): void;
};

const WEEKDAY_LABELS = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"];

/** 把服务端日期转换成旧端右栏可快速扫描的短标签。 */
function dateLabel(value: string): string {
	const date = new Date(`${value}T00:00:00`);
	if (Number.isNaN(date.getTime())) return value;
	return `${date.getMonth() + 1}月${date.getDate()}日 ${WEEKDAY_LABELS[date.getDay()]}`;
}

function dateGroups(schedules: readonly { workDate: string }[]) {
	const counts = new Map<string, number>();
	for (const schedule of schedules) {
		counts.set(schedule.workDate, (counts.get(schedule.workDate) ?? 0) + 1);
	}
	return [...counts.entries()]
		.sort(([first], [second]) => first.localeCompare(second))
		.map(([workDate, count]) => ({
			workDate,
			label: dateLabel(workDate),
			count,
		}));
}

function visibleSchedules(
	schedules: readonly AppointmentSchedule[],
	selectedDate: string,
	visibleCount: number,
) {
	return schedules
		.filter((schedule) => schedule.workDate === selectedDate)
		.slice(0, visibleCount);
}

Page<AppointmentDirectoryPageData, AppointmentDirectoryPageMethods>({
	data: {
		departments: [],
		schedules: [],
		selectedDepartmentId: "",
		selectedDepartmentName: "",
		dateGroups: [],
		selectedDate: "",
		visibleSchedules: [],
		hasMoreSchedules: false,
		visibleScheduleCount: SCHEDULE_PAGE_SIZE,
		loading: true,
		error: "",
	},

	onLoad() {
		this.loadDirectory();
	},

	/** 首屏只读取科室，再按左栏当前选择读取排班。 */
	loadDirectory(): Promise<void> {
		this.setData({ loading: true, error: "" });
		return loadAppointmentDepartments()
			.then((departments) => {
				const selected = departments[0];
				this.setData({
					departments,
					schedules: [],
					selectedDepartmentId: selected?.departmentId ?? "",
					selectedDepartmentName: selected?.displayName ?? "",
					dateGroups: [],
					selectedDate: "",
					visibleSchedules: [],
					hasMoreSchedules: false,
					visibleScheduleCount: SCHEDULE_PAGE_SIZE,
					error: "",
				});
				return selected
					? this.loadDepartmentSchedules(selected.departmentId)
					: undefined;
			})
			.catch((error) => this.showError(error, "预约目录加载失败"))
			.finally(() => this.setData({ loading: false }));
	},

	/** 切换左栏科室时只替换右栏数据，保留级联页面的稳定空间。 */
	loadDepartmentSchedules(departmentId: string): Promise<void> {
		const department = this.data.departments.find(
			(item) => item.departmentId === departmentId,
		);
		if (!department) return Promise.resolve();

		this.setData({
			loading: true,
			error: "",
			selectedDepartmentId: department.departmentId,
			selectedDepartmentName: department.displayName,
			schedules: [],
			dateGroups: [],
			selectedDate: "",
			visibleSchedules: [],
			hasMoreSchedules: false,
			visibleScheduleCount: SCHEDULE_PAGE_SIZE,
		});

		return loadAppointmentSchedules(departmentId)
			.then((schedules) => {
				const groups = dateGroups(schedules);
				const selectedDate = groups[0]?.workDate ?? "";
				const visibleCount = SCHEDULE_PAGE_SIZE;
				this.setData({
					schedules,
					dateGroups: groups,
					selectedDate,
					visibleSchedules: visibleSchedules(
						schedules,
						selectedDate,
						visibleCount,
					),
					hasMoreSchedules: groups[0] ? groups[0].count > visibleCount : false,
					visibleScheduleCount: visibleCount,
					error: "",
				});
			})
			.catch((error) => this.showError(error, "预约排班加载失败"))
			.finally(() => this.setData({ loading: false }));
	},

	onDepartmentTap(event): void {
		const departmentId = event.currentTarget?.dataset?.departmentId;
		if (typeof departmentId !== "string" || !departmentId) return;
		if (departmentId === this.data.selectedDepartmentId && !this.data.error)
			return;
		this.loadDepartmentSchedules(departmentId);
	},

	onDateTap(event): void {
		const selectedDate = event.currentTarget?.dataset?.date;
		if (typeof selectedDate !== "string" || !selectedDate) return;
		const visibleCount = SCHEDULE_PAGE_SIZE;
		const group = this.data.dateGroups.find(
			(item) => item.workDate === selectedDate,
		);
		this.setData({
			selectedDate,
			visibleScheduleCount: visibleCount,
			visibleSchedules: visibleSchedules(
				this.data.schedules,
				selectedDate,
				visibleCount,
			),
			hasMoreSchedules: Boolean(group && group.count > visibleCount),
		});
	},

	onLoadMore(): void {
		const nextCount = this.data.visibleScheduleCount + SCHEDULE_PAGE_SIZE;
		const group = this.data.dateGroups.find(
			(item) => item.workDate === this.data.selectedDate,
		);
		this.setData({
			visibleScheduleCount: nextCount,
			visibleSchedules: visibleSchedules(
				this.data.schedules,
				this.data.selectedDate,
				nextCount,
			),
			hasMoreSchedules: Boolean(group && group.count > nextCount),
		});
	},

	/** 预约写入契约尚未开放，先保留号源点击反馈，不伪造预约成功。 */
	onScheduleTap(): void {
		wx.showToast({ title: "预约下单功能迁移中", icon: "none" });
	},

	onPullDownRefresh(): void {
		this.loadDirectory().finally(() => wx.stopPullDownRefresh());
	},

	showError(error: unknown, fallback: string): void {
		let message = fallback;
		if (error instanceof ApiError) {
			message =
				error.code === "dependency-not-configured"
					? "预约服务暂未配置完成，请联系管理员"
					: error.message;
		}
		this.setData({ error: message });
	},
});
