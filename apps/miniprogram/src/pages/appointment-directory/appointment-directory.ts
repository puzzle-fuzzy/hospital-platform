import { ApiError, contextualApiErrorMessage } from "../../services/api-client";
import {
	groupAppointmentDepartments,
	groupAppointmentDoctorCards,
	groupAppointmentSchedules,
	visibleAppointmentSchedules,
} from "../../services/appointment-directory-view";
import {
	loadAppointmentDepartments,
	loadAppointmentSchedules,
} from "../../services/dashboard-service";
import { navigateToFeatureStatus } from "../../services/feature-navigation";
import {
	disposePageInstance,
	getPageLatestRequestGuard,
} from "../../services/page-instance-state";
import type {
	AppointmentDirectoryMode,
	AppointmentDirectoryPageData,
	AppointmentDoctorCard,
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
	selectDoctor(doctor: AppointmentDoctorCard, requestedDate?: string): void;
	onRetry(): void;
	onGuideTap(): void;
	onSearchInput(event: WechatMiniprogram.Input): void;
	onSearchTap(): void;
	onModeTap(event: WechatMiniprogram.TouchEvent): void;
	onDepartmentGroupTap(event: WechatMiniprogram.TouchEvent): void;
	onDepartmentTap(event: WechatMiniprogram.TouchEvent): void;
	onDoctorCardTap(event: WechatMiniprogram.TouchEvent): void;
	onDoctorDateTap(event: WechatMiniprogram.TouchEvent): void;
	onClearDoctorFilter(): void;
	onDateTap(event: WechatMiniprogram.TouchEvent): void;
	onLoadMore(): void;
	onScheduleTap(event: WechatMiniprogram.TouchEvent): void;
	onPullDownRefresh(): void;
	onUnload(): void;
	showError(error: unknown, fallback: string): void;
};

type SchedulePresentation = Pick<
	AppointmentDirectoryPageData,
	| "dateGroups"
	| "selectedDate"
	| "visibleSchedules"
	| "hasMoreSchedules"
	| "visibleScheduleCount"
>;

function isAppointmentDirectoryMode(
	value: unknown,
): value is AppointmentDirectoryMode {
	return value === "doctor" || value === "date";
}

/**
 * 将排班读模型投影为当前日期/医生筛选下的页面窗口。
 *
 * 所有事件都通过这里重新计算日期分组、可见窗口和“加载更多”状态，避免
 * 旧医生卡片或旧日期事件只改其中一个字段，造成右栏展示不属于当前科室的号源。
 */
function createSchedulePresentation(
	schedules: readonly AppointmentSchedule[],
	selectedDoctorId: string,
	requestedDate: string,
	visibleCount: number,
): SchedulePresentation {
	const dateGroups = groupAppointmentSchedules(schedules, selectedDoctorId);
	const selectedDate = dateGroups.some(
		(group) => group.workDate === requestedDate,
	)
		? requestedDate
		: (dateGroups[0]?.workDate ?? "");
	const group = dateGroups.find((item) => item.workDate === selectedDate);
	return {
		dateGroups,
		selectedDate,
		visibleSchedules: visibleAppointmentSchedules(
			schedules,
			selectedDate,
			visibleCount,
			selectedDoctorId,
		),
		hasMoreSchedules: Boolean(group && group.count > visibleCount),
		visibleScheduleCount: visibleCount,
	};
}

/**
 * 预约目录有两层异步读取：左栏科室和右栏排班。
 * 用户快速切换科室或下拉刷新时，旧 provider 响应可能晚于新响应到达；
 * 两层分别设守卫，防止旧科室的排班覆盖当前选择，也防止旧刷新恢复旧状态。
 */

Page<AppointmentDirectoryPageData, AppointmentDirectoryPageMethods>({
	data: {
		departments: [],
		departmentGroups: [],
		currentGroupDepartments: [],
		selectedDepartmentGroupId: "",
		schedules: [],
		doctorCards: [],
		activeMode: "doctor",
		selectedDepartmentId: "",
		selectedDepartmentName: "",
		selectedDoctorId: "",
		selectedDoctorName: "",
		searchText: "",
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
			departmentGroups: [],
			currentGroupDepartments: [],
			selectedDepartmentGroupId: "",
			schedules: [],
			doctorCards: [],
			activeMode: "doctor",
			selectedDepartmentId: "",
			selectedDepartmentName: "",
			selectedDoctorId: "",
			selectedDoctorName: "",
			dateGroups: [],
			selectedDate: "",
			visibleSchedules: [],
			hasMoreSchedules: false,
			visibleScheduleCount: SCHEDULE_PAGE_SIZE,
		});
		return loadAppointmentDepartments()
			.then((departments) => {
				if (!directoryGuard.isCurrent(directoryToken)) return undefined;
				const departmentGroups = groupAppointmentDepartments(departments);
				const selectedGroup = departmentGroups[0];
				this.setData({
					departments,
					departmentGroups,
					currentGroupDepartments: selectedGroup?.departments ?? [],
					selectedDepartmentGroupId: selectedGroup?.groupId ?? "",
					schedules: [],
					doctorCards: [],
					activeMode: "doctor",
					selectedDepartmentId: "",
					selectedDepartmentName: "",
					selectedDoctorId: "",
					selectedDoctorName: "",
					dateGroups: [],
					selectedDate: "",
					visibleSchedules: [],
					hasMoreSchedules: false,
					visibleScheduleCount: SCHEDULE_PAGE_SIZE,
					error: "",
				});
				return undefined;
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
			activeMode: "doctor",
			selectedDepartmentId: department.departmentId,
			selectedDepartmentName: department.displayName,
			selectedDoctorId: "",
			selectedDoctorName: "",
			schedules: [],
			doctorCards: [],
			dateGroups: [],
			selectedDate: "",
			visibleSchedules: [],
			hasMoreSchedules: false,
			visibleScheduleCount: SCHEDULE_PAGE_SIZE,
		});

		return loadAppointmentSchedules(departmentId)
			.then((schedules) => {
				if (!scheduleGuard.isCurrent(scheduleToken)) return;
				const presentation = createSchedulePresentation(
					schedules,
					"",
					"",
					SCHEDULE_PAGE_SIZE,
				);
				this.setData({
					schedules,
					doctorCards: groupAppointmentDoctorCards(schedules),
					activeMode: "doctor",
					selectedDoctorId: "",
					selectedDoctorName: "",
					...presentation,
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

	/**
	 * 预约目录错误态只允许从头重读科室和排班两层目录。
	 * 局部保留的旧科室/排班不能在错误恢复时直接使用，否则用户看到的
	 * 可能是上一轮 Provider 快照，重试也无法证明当前目录已经重新收敛。
	 */
	onRetry(): void {
		void this.loadDirectory();
	},

	/** 旧端顶部导诊入口保留位置，尚未开放的内容统一进入受控状态页。 */
	onGuideTap(): void {
		navigateToFeatureStatus("guide");
	},

	/** 输入只保留在当前页面；搜索请求不会透传给 Provider。 */
	onSearchInput(event): void {
		const rawValue = event.detail?.value;
		const searchText =
			typeof rawValue === "string"
				? rawValue.replace(/[\r\n]/gu, "").slice(0, 32)
				: "";
		this.setData({ searchText });
	},

	/**
	 * 旧端搜索框支持科室或医生名称。新端只在已经取得的安全目录中定位，
	 * 不为了全文检索读取所有科室排班，也不会把自由文本发送给 Provider。
	 */
	onSearchTap(): void {
		if (this.data.loading) return;
		const keyword = this.data.searchText.trim().toLocaleLowerCase();
		if (!keyword) {
			wx.showToast({ title: "请输入科室或医生名字", icon: "none" });
			return;
		}

		const department = this.data.departments.find((item) =>
			item.displayName.toLocaleLowerCase().includes(keyword),
		);
		if (department) {
			const group = this.data.departmentGroups.find((item) =>
				item.departments.some(
					(candidate) => candidate.departmentId === department.departmentId,
				),
			);
			if (group && group.groupId !== this.data.selectedDepartmentGroupId) {
				// 搜索定位到其他一级分类时，先淘汰旧科室的在途排班，再切换右栏。
				getPageLatestRequestGuard(this, "schedule").begin();
				this.setData({
					selectedDepartmentGroupId: group.groupId,
					currentGroupDepartments: group.departments,
					selectedDepartmentId: "",
					selectedDepartmentName: "",
					selectedDoctorId: "",
					selectedDoctorName: "",
					schedules: [],
					doctorCards: [],
					dateGroups: [],
					selectedDate: "",
					visibleSchedules: [],
					hasMoreSchedules: false,
					visibleScheduleCount: SCHEDULE_PAGE_SIZE,
					error: "",
					loading: false,
				});
			}
			if (department.departmentId !== this.data.selectedDepartmentId) {
				void this.loadDepartmentSchedules(department.departmentId);
				return;
			}
		}

		const doctor = this.data.doctorCards.find((item) =>
			item.doctorName.toLocaleLowerCase().includes(keyword),
		);
		if (doctor) {
			this.selectDoctor(doctor);
			return;
		}

		if (department) {
			wx.showToast({ title: "当前科室已展示", icon: "none" });
			return;
		}
		wx.showToast({ title: "未找到匹配的科室或医生", icon: "none" });
	},

	onModeTap(event): void {
		const mode = event.currentTarget?.dataset?.mode;
		if (!isAppointmentDirectoryMode(mode) || mode === this.data.activeMode)
			return;
		this.setData({ activeMode: mode });
	},

	/** 切换蓝湖左侧一级分类，只替换当前可展开的真实科室，不发起虚构分类查询。 */
	onDepartmentGroupTap(event): void {
		const groupId = event.currentTarget?.dataset?.groupId;
		if (typeof groupId !== "string" || !groupId) return;
		const group = this.data.departmentGroups.find(
			(item) => item.groupId === groupId,
		);
		if (!group || group.groupId === this.data.selectedDepartmentGroupId) return;

		// 左栏切换会让旧右栏排班失去展示资格；不等待它结束，也不能让它回写。
		getPageLatestRequestGuard(this, "schedule").begin();
		this.setData({
			selectedDepartmentGroupId: group.groupId,
			currentGroupDepartments: group.departments,
			selectedDepartmentId: "",
			selectedDepartmentName: "",
			selectedDoctorId: "",
			selectedDoctorName: "",
			schedules: [],
			doctorCards: [],
			activeMode: "doctor",
			dateGroups: [],
			selectedDate: "",
			visibleSchedules: [],
			hasMoreSchedules: false,
			visibleScheduleCount: SCHEDULE_PAGE_SIZE,
			loading: false,
			error: "",
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
		) {
			// 与蓝湖右栏一致：再次点击已展开的二级科室会收起它的医生/号源。
			getPageLatestRequestGuard(this, "schedule").begin();
			this.setData({
				selectedDepartmentId: "",
				selectedDepartmentName: "",
				selectedDoctorId: "",
				selectedDoctorName: "",
				schedules: [],
				doctorCards: [],
				activeMode: "doctor",
				dateGroups: [],
				selectedDate: "",
				visibleSchedules: [],
				hasMoreSchedules: false,
				visibleScheduleCount: SCHEDULE_PAGE_SIZE,
				loading: false,
			});
			return;
		}
		void this.loadDepartmentSchedules(department.departmentId);
	},

	/** 医生卡片只切换到当前已读排班的日期视图，不附带医生详情或写入引用。 */
	onDoctorCardTap(event): void {
		const doctorId = event.currentTarget?.dataset?.doctorId;
		if (typeof doctorId !== "string" || !doctorId) return;
		const doctor = this.data.doctorCards.find(
			(item) => item.doctorId === doctorId,
		);
		if (!doctor) return;
		this.selectDoctor(doctor);
	},

	/** 日期标签来自当前医生卡片，事件必须同时属于当前卡片和当前日期集合。 */
	onDoctorDateTap(event): void {
		const doctorId = event.currentTarget?.dataset?.doctorId;
		const workDate = event.currentTarget?.dataset?.date;
		if (
			typeof doctorId !== "string" ||
			!doctorId ||
			typeof workDate !== "string" ||
			!workDate
		)
			return;
		const doctor = this.data.doctorCards.find(
			(item) => item.doctorId === doctorId,
		);
		if (!doctor?.dates.some((item) => item.workDate === workDate)) return;
		this.selectDoctor(doctor, workDate);
	},

	/** 将医生卡片转换为本地日期筛选；不再读取任何额外 Provider 字段。 */
	selectDoctor(doctor: AppointmentDoctorCard, requestedDate = ""): void {
		const currentDoctor = this.data.doctorCards.find(
			(item) => item.doctorId === doctor.doctorId,
		);
		if (!currentDoctor) return;
		const presentation = createSchedulePresentation(
			this.data.schedules,
			currentDoctor.doctorId,
			requestedDate || currentDoctor.dates[0]?.workDate || "",
			SCHEDULE_PAGE_SIZE,
		);
		this.setData({
			activeMode: "date",
			selectedDoctorId: currentDoctor.doctorId,
			selectedDoctorName: currentDoctor.doctorName,
			...presentation,
		});
	},

	/** 清除医生筛选后回到蓝湖首屏对应的当前科室医生列表。 */
	onClearDoctorFilter(): void {
		if (!this.data.selectedDoctorId) return;
		const presentation = createSchedulePresentation(
			this.data.schedules,
			"",
			this.data.selectedDate,
			SCHEDULE_PAGE_SIZE,
		);
		this.setData({
			activeMode: "doctor",
			selectedDoctorId: "",
			selectedDoctorName: "",
			...presentation,
		});
	},

	/** 当前日期只能属于当前科室/医生的日期分组。 */
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
			activeMode: "date",
			selectedDate,
			visibleScheduleCount: visibleCount,
			visibleSchedules: visibleAppointmentSchedules(
				this.data.schedules,
				selectedDate,
				visibleCount,
				this.data.selectedDoctorId,
			),
			hasMoreSchedules: group.count > visibleCount,
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
				this.data.selectedDoctorId,
			),
			hasMoreSchedules: group.count > nextCount,
		});
	},

	/**
	 * 点击前重新回查当前可见的安全读模型：旧 WXML 的按钮事件不能把已刷新、
	 * 已约满或不属于当前日期的排班当作可预约资源。写入契约尚未开放，
	 * 通过验证后统一进入状态页，不伪造预约成功。
	 */
	onScheduleTap(event): void {
		const scheduleId = event.currentTarget?.dataset?.scheduleId;
		if (typeof scheduleId !== "string" || !scheduleId) return;
		const schedule = this.data.visibleSchedules.find(
			(item) => item.scheduleId === scheduleId,
		);
		if (!schedule) return;
		if (schedule.availableSlots <= 0) {
			wx.showToast({ title: "当前号源已约满", icon: "none" });
			return;
		}
		navigateToFeatureStatus("appointment-write");
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
					? "预约服务正在完善中，暂时无法使用"
					: contextualApiErrorMessage(
							error,
							"预约信息暂时无法获取，请稍后再试",
						);
		}
		this.setData({ error: message });
	},
});
