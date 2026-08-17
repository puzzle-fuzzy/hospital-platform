import { ApiError, safeApiErrorMessage } from "../../services/api-client";
import {
	loadAppointmentDepartments,
	loadAppointmentSchedules,
} from "../../services/dashboard-service";
import {
	disposePageInstance,
	getPageLatestRequestGuard,
} from "../../services/page-instance-state";
import type {
	AppointmentDirectoryPageData,
	AppointmentSchedule,
} from "../../types";

/**
 * 当前右侧最多绘制的号源数量，继续加载由用户明确触发。
 *
 * 这是小程序本地渲染批次，不是服务端分页：网络请求仍按服务端日期窗口
 * 取得完整结果，不能把 `hasMoreSchedules` 当作 provider 还有未读取数据的证明。
 */
const SCHEDULE_PAGE_SIZE = 12;

type AppointmentDirectoryPageMethods = {
	loadDirectory(): Promise<void>;
	loadDepartmentSchedules(departmentId: string): Promise<void>;
	onDepartmentTap(event: WechatMiniprogram.TouchEvent): void;
	onDateTap(event: WechatMiniprogram.TouchEvent): void;
	onLoadMore(): void;
	onScheduleTap(): void;
	onPullDownRefresh(): void;
	onUnload(): void;
	showError(error: unknown, fallback: string): void;
};

const WEEKDAY_LABELS = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"];

/**
 * 预约目录有两层异步读取：左栏科室和右栏排班。
 * 用户快速切换科室或下拉刷新时，旧 provider 响应可能晚于新响应到达；
 * 两层分别设守卫，防止旧科室的排班覆盖当前选择，也防止旧刷新恢复旧状态。
 */
/** 把服务端日期转换成旧端右栏可快速扫描的短标签。 */
function dateLabel(value: string): string {
	// `workDate` 是医院业务日历，而不是用户设备所在时区的瞬时时间。
	// 固定用 UTC 解析纯日期并读取 UTC 字段，把 UTC 当作不会发生偏移的
	// 日历容器；否则海外设备可能把医院日期显示成前一天或后一天。
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
		const directoryGuard = getPageLatestRequestGuard(this, "directory");
		const scheduleGuard = getPageLatestRequestGuard(this, "schedule");
		const directoryToken = directoryGuard.begin();
		// 新一轮科室目录会使上一轮右栏排班失效，避免刷新完成后旧排班回写。
		const directoryScheduleToken = scheduleGuard.begin();
		// 刷新开始后，上一轮科室和排班都不再代表当前读取；只让请求守卫失效
		// 还不够，因为请求等待期间 WXML 仍可能展示旧号源。先清空整个级联
		// 读模型，等新科室和对应排班都成功后再恢复页面内容。
		this.setData({
			loading: true,
			error: "",
			departments: [],
			schedules: [],
			selectedDepartmentId: "",
			selectedDepartmentName: "",
			dateGroups: [],
			selectedDate: "",
			visibleSchedules: [],
			hasMoreSchedules: false,
			visibleScheduleCount: SCHEDULE_PAGE_SIZE,
		});
		return loadAppointmentDepartments()
			.then((departments) => {
				if (!directoryGuard.isCurrent(directoryToken)) return undefined;
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
			.catch((error) => {
				if (directoryGuard.isCurrent(directoryToken)) {
					this.showError(error, "预约目录加载失败");
				}
			})
			.finally(() => {
				// 目录请求启动的排班读取可能已经被用户切换科室淘汰；此时
				// loading 的结束权属于新的科室请求，外层不能提前结束它的加载态。
				if (
					directoryGuard.isCurrent(directoryToken) &&
					scheduleGuard.isCurrent(directoryScheduleToken)
				) {
					this.setData({ loading: false });
				}
			});
	},

	/** 切换左栏科室时只替换右栏数据，保留级联页面的稳定空间。 */
	loadDepartmentSchedules(departmentId: string): Promise<void> {
		const department = this.data.departments.find(
			(item) => item.departmentId === departmentId,
		);
		if (!department) return Promise.resolve();

		const scheduleGuard = getPageLatestRequestGuard(this, "schedule");
		const scheduleToken = scheduleGuard.begin();

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
				if (!scheduleGuard.isCurrent(scheduleToken)) return;
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
			.catch((error) => {
				if (scheduleGuard.isCurrent(scheduleToken)) {
					this.showError(error, "预约排班加载失败");
				}
			})
			.finally(() => {
				if (scheduleGuard.isCurrent(scheduleToken)) {
					this.setData({ loading: false });
				}
			});
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

	/** 页面卸载后让科室与排班请求失去回写资格。 */
	onUnload(): void {
		disposePageInstance(this);
	},

	showError(error: unknown, fallback: string): void {
		let message = fallback;
		if (error instanceof ApiError) {
			message =
				error.code === "dependency-not-configured"
					? "预约服务暂未配置完成，请联系管理员"
					: safeApiErrorMessage(error, fallback);
		}
		this.setData({ error: message });
	},
});
