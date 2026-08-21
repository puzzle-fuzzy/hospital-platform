import { ApiError, safeApiErrorMessage } from "../../services/api-client";
import {
	groupAppointmentSchedules,
	visibleAppointmentSchedules,
} from "../../services/appointment-directory-view";
import {
	loadAppointmentDepartments,
	loadAppointmentSchedules,
} from "../../services/dashboard-service";
import {
	disposePageInstance,
	getPageLatestRequestGuard,
} from "../../services/page-instance-state";
import type { AppointmentDirectoryPageData } from "../../types";

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

/**
 * 预约目录有两层异步读取：左栏科室和右栏排班。
 * 用户快速切换科室或下拉刷新时，旧 provider 响应可能晚于新响应到达；
 * 两层分别设守卫，防止旧科室的排班覆盖当前选择，也防止旧刷新恢复旧状态。
 */

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
				const groups = groupAppointmentSchedules(schedules);
				const selectedDate = groups[0]?.workDate ?? "";
				const visibleCount = SCHEDULE_PAGE_SIZE;
				this.setData({
					schedules,
					dateGroups: groups,
					selectedDate,
					visibleSchedules: visibleAppointmentSchedules(
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
		const department = this.data.departments.find(
			(item) => item.departmentId === departmentId,
		);
		if (!department) {
			// 刷新或重新加载科室期间，旧 WXML 可能晚于当前目录触发点击。
			// 事件携带的 departmentId 不能直接成为新的查询条件，必须先确认
			// 它仍属于当前页面的科室读模型，避免旧级联上下文重新发起请求。
			return;
		}
		if (
			department.departmentId === this.data.selectedDepartmentId &&
			!this.data.error
		)
			return;
		this.loadDepartmentSchedules(department.departmentId);
	},

	onDateTap(event): void {
		const selectedDate = event.currentTarget?.dataset?.date;
		if (typeof selectedDate !== "string" || !selectedDate) return;
		const visibleCount = SCHEDULE_PAGE_SIZE;
		const group = this.data.dateGroups.find(
			(item) => item.workDate === selectedDate,
		);
		if (!group) {
			// 刷新或切换科室时，旧 WXML 事件可能晚于当前日期分组抵达。
			// 这类日期已经不属于当前科室的读模型，不能仅凭事件参数写入
			// selectedDate，否则页面会出现“当前日期不在日期标签中”的假状态。
			return;
		}
		this.setData({
			selectedDate,
			visibleScheduleCount: visibleCount,
			visibleSchedules: visibleAppointmentSchedules(
				this.data.schedules,
				selectedDate,
				visibleCount,
			),
			hasMoreSchedules: Boolean(group && group.count > visibleCount),
		});
	},

	onLoadMore(): void {
		const group = this.data.dateGroups.find(
			(item) => item.workDate === this.data.selectedDate,
		);
		// “加载更多”是旧 WXML 事件，可能在刷新、切换科室或切换日期后才
		// 抵达。不能只相信按钮当时曾经显示过：当前页面必须仍处于可展开的
		// 日期分组、非加载状态，并且服务端本次读模型确实还有未展示的号源。
		// 这只是本地渲染窗口门禁，不把旧事件误认为 Provider 分页事实。
		if (!group || this.data.loading || !this.data.hasMoreSchedules) return;
		const nextCount = Math.min(
			this.data.visibleScheduleCount + SCHEDULE_PAGE_SIZE,
			group.count,
		);
		if (nextCount <= this.data.visibleScheduleCount) return;
		this.setData({
			visibleScheduleCount: nextCount,
			visibleSchedules: visibleAppointmentSchedules(
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
