import { ApiError, contextualApiErrorMessage } from "../../services/api-client";
import {
	groupAppointmentDoctorCards,
	groupAppointmentSchedules,
	visibleAppointmentSchedules,
} from "../../services/appointment-directory-view";
import {
	loadAppointmentClinicDepartments,
	loadAppointmentDepartmentTree,
	loadAppointmentSchedules,
} from "../../services/dashboard-service";
import { navigateToFeatureStatus } from "../../services/feature-navigation";
import {
	disposePageInstance,
	getPageLatestRequestGuard,
} from "../../services/page-instance-state";
import type {
	AppointmentClinicDepartment,
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
	loadClinicDepartments(departmentId: string): Promise<void>;
	loadClinicSchedules(clinic: AppointmentClinicDepartment): Promise<void>;
	selectDoctor(doctor: AppointmentDoctorCard, requestedDate?: string): void;
	onRetry(): void;
	onGuideTap(): void;
	onSearchInput(event: WechatMiniprogram.Input): void;
	onSearchTap(): void;
	onModeTap(event: WechatMiniprogram.TouchEvent): void;
	onDepartmentGroupTap(event: WechatMiniprogram.TouchEvent): void;
	onDepartmentTap(event: WechatMiniprogram.TouchEvent): void;
	onClinicDepartmentTap(event: WechatMiniprogram.TouchEvent): void;
	onDoctorCardTap(event: WechatMiniprogram.TouchEvent): void;
	onDoctorDateTap(event: WechatMiniprogram.TouchEvent): void;
	onClearDoctorFilter(): void;
	onDateTap(event: WechatMiniprogram.TouchEvent): void;
	onLoadMore(): void;
	onScheduleTap(event: WechatMiniprogram.TouchEvent): void;
	onPullDownRefresh(): void;
	onUnload(): void;
	onClinicRetry(): void;
	onScheduleRetry(): void;
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
 * 一级目录、细分门诊和排班都使用同一套受控错误文案；调用方决定错误展示范围，
 * 以免局部读取失败时把已验证的一、二级目录误隐藏为整页失败。
 */
function appointmentDirectoryErrorMessage(
	error: unknown,
	fallback: string,
): string {
	if (!(error instanceof ApiError)) return fallback;
	return error.code === "dependency-not-configured"
		? "预约服务正在完善中，暂时无法使用"
		: contextualApiErrorMessage(error, "预约信息暂时无法获取，请稍后再试");
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
 * 预约目录分三级异步读取：一级/二级目录、细分门诊和医生/排班。
 * 用户快速切换科室或下拉刷新时，旧 provider 响应可能晚于新响应到达；
 * 每一层分别设守卫，防止旧响应覆盖当前选择，也防止旧刷新恢复旧状态。
 */

Page<AppointmentDirectoryPageData, AppointmentDirectoryPageMethods>({
	data: {
		departments: [],
		departmentGroups: [],
		currentGroupDepartments: [],
		selectedDepartmentGroupId: "",
		clinicDepartments: [],
		schedules: [],
		doctorCards: [],
		activeMode: "doctor",
		selectedDepartmentId: "",
		selectedDepartmentName: "",
		selectedClinicDepartmentId: "",
		selectedClinicDepartmentName: "",
		selectedDoctorId: "",
		selectedDoctorName: "",
		searchText: "",
		dateGroups: [],
		selectedDate: "",
		visibleSchedules: [],
		hasMoreSchedules: false,
		visibleScheduleCount: SCHEDULE_PAGE_SIZE,
		loading: true,
		clinicLoading: false,
		scheduleLoading: false,
		error: "",
		clinicError: "",
		scheduleError: "",
	},

	onLoad() {
		this.loadDirectory();
	},

	/** 首屏只读取旧项目同源的一级/二级科室树，不预读三级门诊或医生。 */
	loadDirectory(): Promise<void> {
		const directoryGuard = getPageLatestRequestGuard(this, "directory");
		const clinicGuard = getPageLatestRequestGuard(this, "clinic");
		const scheduleGuard = getPageLatestRequestGuard(this, "schedule");
		const directoryToken = directoryGuard.begin();
		const directoryClinicToken = clinicGuard.begin();
		// 新一轮目录会使已展开的三级门诊和排班都失效，避免旧响应回写。
		const directoryScheduleToken = scheduleGuard.begin();
		this.setData({
			loading: true,
			clinicLoading: false,
			scheduleLoading: false,
			error: "",
			clinicError: "",
			scheduleError: "",
			departments: [],
			departmentGroups: [],
			currentGroupDepartments: [],
			selectedDepartmentGroupId: "",
			clinicDepartments: [],
			schedules: [],
			doctorCards: [],
			activeMode: "doctor",
			selectedDepartmentId: "",
			selectedDepartmentName: "",
			selectedClinicDepartmentId: "",
			selectedClinicDepartmentName: "",
			selectedDoctorId: "",
			selectedDoctorName: "",
			dateGroups: [],
			selectedDate: "",
			visibleSchedules: [],
			hasMoreSchedules: false,
			visibleScheduleCount: SCHEDULE_PAGE_SIZE,
		});
		return loadAppointmentDepartmentTree()
			.then((departmentGroups) => {
				if (!directoryGuard.isCurrent(directoryToken)) return undefined;
				const selectedGroup = departmentGroups[0];
				this.setData({
					departments: departmentGroups.flatMap((group) => group.departments),
					departmentGroups,
					currentGroupDepartments: selectedGroup?.departments ?? [],
					selectedDepartmentGroupId: selectedGroup?.groupId ?? "",
					clinicDepartments: [],
					schedules: [],
					doctorCards: [],
					activeMode: "doctor",
					selectedDepartmentId: "",
					selectedDepartmentName: "",
					selectedClinicDepartmentId: "",
					selectedClinicDepartmentName: "",
					selectedDoctorId: "",
					selectedDoctorName: "",
					dateGroups: [],
					selectedDate: "",
					visibleSchedules: [],
					hasMoreSchedules: false,
					visibleScheduleCount: SCHEDULE_PAGE_SIZE,
					error: "",
					clinicError: "",
					scheduleError: "",
				});
				return undefined;
			})
			.catch((error) => {
				if (directoryGuard.isCurrent(directoryToken)) {
					this.setData({
						error: appointmentDirectoryErrorMessage(error, "预约目录加载失败"),
					});
				}
			})
			.finally(() => {
				if (
					directoryGuard.isCurrent(directoryToken) &&
					clinicGuard.isCurrent(directoryClinicToken) &&
					scheduleGuard.isCurrent(directoryScheduleToken)
				) {
					this.setData({ loading: false });
				}
			});
	},

	/** 展开二级科室时读取真实三级门诊，绝不把医生卡片当作三级目录。 */
	loadClinicDepartments(departmentId: string): Promise<void> {
		const department = this.data.departments.find(
			(item) => item.departmentId === departmentId,
		);
		if (!department) return Promise.resolve();

		const clinicGuard = getPageLatestRequestGuard(this, "clinic");
		const scheduleGuard = getPageLatestRequestGuard(this, "schedule");
		const clinicToken = clinicGuard.begin();
		scheduleGuard.begin();

		this.setData({
			clinicLoading: true,
			scheduleLoading: false,
			error: "",
			clinicError: "",
			scheduleError: "",
			activeMode: "doctor",
			selectedDepartmentId: department.departmentId,
			selectedDepartmentName: department.displayName,
			selectedClinicDepartmentId: "",
			selectedClinicDepartmentName: "",
			clinicDepartments: [],
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

		return loadAppointmentClinicDepartments(departmentId)
			.then((clinicDepartments) => {
				if (!clinicGuard.isCurrent(clinicToken)) return;
				this.setData({
					clinicDepartments,
					clinicError: "",
				});
			})
			.catch((error) => {
				if (clinicGuard.isCurrent(clinicToken)) {
					this.setData({
						clinicError: appointmentDirectoryErrorMessage(
							error,
							"细分门诊加载失败",
						),
					});
				}
			})
			.finally(() => {
				if (clinicGuard.isCurrent(clinicToken)) {
					this.setData({ clinicLoading: false });
				}
			});
	},

	/** 用户明确选中最末级门诊后，才读取该门诊的医生与号源。 */
	loadClinicSchedules(clinic: AppointmentClinicDepartment): Promise<void> {
		if (
			!this.data.clinicDepartments.some(
				(item) => item.departmentId === clinic.departmentId,
			)
		) {
			return Promise.resolve();
		}
		const scheduleGuard = getPageLatestRequestGuard(this, "schedule");
		const scheduleToken = scheduleGuard.begin();
		this.setData({
			scheduleLoading: true,
			error: "",
			scheduleError: "",
			activeMode: "doctor",
			selectedClinicDepartmentId: clinic.departmentId,
			selectedClinicDepartmentName: clinic.displayName,
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
		return loadAppointmentSchedules(clinic.departmentId)
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
					scheduleError: "",
				});
			})
			.catch((error) => {
				if (scheduleGuard.isCurrent(scheduleToken)) {
					this.setData({
						scheduleError: appointmentDirectoryErrorMessage(
							error,
							"预约排班加载失败",
						),
					});
				}
			})
			.finally(() => {
				if (scheduleGuard.isCurrent(scheduleToken)) {
					this.setData({ scheduleLoading: false });
				}
			});
	},

	/** 一级/二级目录失败时从头读取目录；局部失败分别在当前展开项重试。 */
	onRetry(): void {
		void this.loadDirectory();
	},

	onClinicRetry(): void {
		if (!this.data.selectedDepartmentId) return;
		void this.loadClinicDepartments(this.data.selectedDepartmentId);
	},

	onScheduleRetry(): void {
		const clinic = this.data.clinicDepartments.find(
			(item) => item.departmentId === this.data.selectedClinicDepartmentId,
		);
		if (!clinic) return;
		void this.loadClinicSchedules(clinic);
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

	/** 搜索仅定位当前已读取的一级/二级/三级目录和医生，不透传自由文本。 */
	onSearchTap(): void {
		if (this.data.loading) return;
		const keyword = this.data.searchText.trim().toLocaleLowerCase();
		if (!keyword) {
			wx.showToast({ title: "请输入科室或医生名字", icon: "none" });
			return;
		}

		const departmentGroup = this.data.departmentGroups.find((item) =>
			item.displayName.toLocaleLowerCase().includes(keyword),
		);
		if (departmentGroup) {
			if (departmentGroup.groupId !== this.data.selectedDepartmentGroupId) {
				// 命中一级分类只定位二级目录；三级门诊和排班仍须由用户明确展开。
				getPageLatestRequestGuard(this, "clinic").begin();
				getPageLatestRequestGuard(this, "schedule").begin();
				this.setData({
					selectedDepartmentGroupId: departmentGroup.groupId,
					currentGroupDepartments: departmentGroup.departments,
					selectedDepartmentId: "",
					selectedDepartmentName: "",
					selectedClinicDepartmentId: "",
					selectedClinicDepartmentName: "",
					clinicDepartments: [],
					clinicLoading: false,
					scheduleLoading: false,
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
					clinicError: "",
					scheduleError: "",
					loading: false,
				});
				return;
			}
			wx.showToast({ title: "当前分类已展示", icon: "none" });
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
				// 搜索切换一级分类时，三级门诊和排班的旧响应均失去回写资格。
				getPageLatestRequestGuard(this, "clinic").begin();
				getPageLatestRequestGuard(this, "schedule").begin();
				this.setData({
					selectedDepartmentGroupId: group.groupId,
					currentGroupDepartments: group.departments,
					selectedDepartmentId: "",
					selectedDepartmentName: "",
					selectedClinicDepartmentId: "",
					selectedClinicDepartmentName: "",
					clinicDepartments: [],
					clinicLoading: false,
					scheduleLoading: false,
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
					clinicError: "",
					scheduleError: "",
					loading: false,
				});
			}
			if (department.departmentId !== this.data.selectedDepartmentId) {
				void this.loadClinicDepartments(department.departmentId);
				return;
			}
		}

		const clinic = this.data.clinicDepartments.find((item) =>
			item.displayName.toLocaleLowerCase().includes(keyword),
		);
		if (clinic) {
			if (clinic.departmentId !== this.data.selectedClinicDepartmentId) {
				void this.loadClinicSchedules(clinic);
				return;
			}
			wx.showToast({ title: "当前门诊已展示", icon: "none" });
			return;
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
		wx.showToast({ title: "未找到匹配的科室、门诊或医生", icon: "none" });
	},

	onModeTap(event): void {
		const mode = event.currentTarget?.dataset?.mode;
		if (!isAppointmentDirectoryMode(mode) || mode === this.data.activeMode)
			return;
		this.setData({ activeMode: mode });
	},

	/** 切换左侧真实一级科室，只更换其二级列表，不发起虚构分类查询。 */
	onDepartmentGroupTap(event): void {
		const groupId = event.currentTarget?.dataset?.groupId;
		if (typeof groupId !== "string" || !groupId) return;
		const group = this.data.departmentGroups.find(
			(item) => item.groupId === groupId,
		);
		if (!group || group.groupId === this.data.selectedDepartmentGroupId) return;

		// 左栏切换会让旧的三级门诊和排班失去展示资格，不能让它们回写。
		getPageLatestRequestGuard(this, "clinic").begin();
		getPageLatestRequestGuard(this, "schedule").begin();
		this.setData({
			selectedDepartmentGroupId: group.groupId,
			currentGroupDepartments: group.departments,
			selectedDepartmentId: "",
			selectedDepartmentName: "",
			selectedClinicDepartmentId: "",
			selectedClinicDepartmentName: "",
			clinicDepartments: [],
			clinicLoading: false,
			scheduleLoading: false,
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
			clinicError: "",
			scheduleError: "",
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
			!this.data.clinicError
		) {
			// 与图 1 一致：再次点击已展开二级科室会收起三级门诊及其号源。
			getPageLatestRequestGuard(this, "clinic").begin();
			getPageLatestRequestGuard(this, "schedule").begin();
			this.setData({
				selectedDepartmentId: "",
				selectedDepartmentName: "",
				selectedClinicDepartmentId: "",
				selectedClinicDepartmentName: "",
				clinicDepartments: [],
				clinicLoading: false,
				scheduleLoading: false,
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
				clinicError: "",
				scheduleError: "",
			});
			return;
		}
		void this.loadClinicDepartments(department.departmentId);
	},

	/** 三级门诊的 ID 只能来自当前已加载目录，随后才允许读取医生和排班。 */
	onClinicDepartmentTap(event): void {
		const clinicDepartmentId = event.currentTarget?.dataset?.clinicDepartmentId;
		if (typeof clinicDepartmentId !== "string" || !clinicDepartmentId) return;
		const clinic = this.data.clinicDepartments.find(
			(item) => item.departmentId === clinicDepartmentId,
		);
		if (!clinic) return;
		if (
			clinic.departmentId === this.data.selectedClinicDepartmentId &&
			!this.data.scheduleError
		) {
			getPageLatestRequestGuard(this, "schedule").begin();
			this.setData({
				selectedClinicDepartmentId: "",
				selectedClinicDepartmentName: "",
				scheduleLoading: false,
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
				scheduleError: "",
			});
			return;
		}
		void this.loadClinicSchedules(clinic);
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
});
