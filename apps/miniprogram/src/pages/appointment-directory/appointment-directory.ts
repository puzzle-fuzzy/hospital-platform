import { ApiError, contextualApiErrorMessage } from "../../services/api-client";
import {
	loadAppointmentClinicDepartments,
	loadAppointmentDepartmentTree,
} from "../../services/dashboard-service";
import { navigateToFeatureStatus } from "../../services/feature-navigation";
import {
	disposePageInstance,
	getPageLatestRequestGuard,
} from "../../services/page-instance-state";
import type {
	AppointmentClinicDepartment,
	AppointmentDirectoryPageData,
} from "../../types";

/**
 * 选择科室只负责旧项目同源的一、二、三级目录。
 *
 * 点击三级门诊后必须跳转到独立的 `appointment-schedule` 页面，由目标页
 * 自己重新读取排班、展示“按医生挂号 / 按日期挂号”。目录页不保留医生或
 * 号源，避免页面返回时把旧门诊的异步响应回写到新的级联选择上。
 */

type AppointmentDirectoryPageMethods = {
	loadDirectory(): Promise<void>;
	loadClinicDepartments(departmentId: string): Promise<void>;
	openClinicSchedule(clinic: AppointmentClinicDepartment): void;
	onRetry(): void;
	onGuideTap(): void;
	onSearchInput(event: WechatMiniprogram.Input): void;
	onSearchTap(): void;
	onDepartmentGroupTap(event: WechatMiniprogram.TouchEvent): void;
	onDepartmentTap(event: WechatMiniprogram.TouchEvent): void;
	onClinicDepartmentTap(event: WechatMiniprogram.TouchEvent): void;
	onPullDownRefresh(): void;
	onUnload(): void;
	onClinicRetry(): void;
};

function appointmentDirectoryErrorMessage(
	error: unknown,
	fallback: string,
): string {
	if (!(error instanceof ApiError)) return fallback;
	return error.code === "dependency-not-configured"
		? "预约服务正在完善中，暂时无法使用"
		: contextualApiErrorMessage(error, "预约目录暂时无法获取，请稍后再试");
}

function resetExpandedClinicState(): Pick<
	AppointmentDirectoryPageData,
	| "selectedDepartmentId"
	| "selectedDepartmentName"
	| "clinicDepartments"
	| "clinicLoading"
	| "clinicError"
> {
	return {
		selectedDepartmentId: "",
		selectedDepartmentName: "",
		clinicDepartments: [],
		clinicLoading: false,
		clinicError: "",
	};
}

Page<AppointmentDirectoryPageData, AppointmentDirectoryPageMethods>({
	data: {
		departments: [],
		departmentGroups: [],
		currentGroupDepartments: [],
		selectedDepartmentGroupId: "",
		clinicDepartments: [],
		selectedDepartmentId: "",
		selectedDepartmentName: "",
		searchText: "",
		loading: true,
		clinicLoading: false,
		error: "",
		clinicError: "",
	},

	onLoad() {
		void this.loadDirectory();
	},

	/** 首屏只读取旧项目同源的一、二级科室树，不预读细分门诊或医生。 */
	loadDirectory(): Promise<void> {
		const directoryGuard = getPageLatestRequestGuard(this, "directory");
		const clinicGuard = getPageLatestRequestGuard(this, "clinic");
		const directoryToken = directoryGuard.begin();
		const directoryClinicToken = clinicGuard.begin();
		this.setData({
			loading: true,
			error: "",
			departments: [],
			departmentGroups: [],
			currentGroupDepartments: [],
			selectedDepartmentGroupId: "",
			...resetExpandedClinicState(),
		});

		return loadAppointmentDepartmentTree()
			.then((departmentGroups) => {
				if (!directoryGuard.isCurrent(directoryToken)) return;
				const selectedGroup = departmentGroups[0];
				this.setData({
					departments: departmentGroups.flatMap((group) => group.departments),
					departmentGroups,
					currentGroupDepartments: selectedGroup?.departments ?? [],
					selectedDepartmentGroupId: selectedGroup?.groupId ?? "",
					error: "",
					...resetExpandedClinicState(),
				});
			})
			.catch((error) => {
				if (!directoryGuard.isCurrent(directoryToken)) return;
				this.setData({
					error: appointmentDirectoryErrorMessage(error, "预约目录加载失败"),
				});
			})
			.finally(() => {
				if (
					directoryGuard.isCurrent(directoryToken) &&
					clinicGuard.isCurrent(directoryClinicToken)
				) {
					this.setData({ loading: false });
				}
			});
	},

	/** 展开二级科室时仅读取真实三级门诊；医生由下一页读取。 */
	loadClinicDepartments(departmentId: string): Promise<void> {
		const department = this.data.departments.find(
			(item) => item.departmentId === departmentId,
		);
		if (!department) return Promise.resolve();

		const clinicGuard = getPageLatestRequestGuard(this, "clinic");
		const clinicToken = clinicGuard.begin();
		this.setData({
			clinicLoading: true,
			clinicError: "",
			selectedDepartmentId: department.departmentId,
			selectedDepartmentName: department.displayName,
			clinicDepartments: [],
		});

		return loadAppointmentClinicDepartments(department.departmentId)
			.then((clinicDepartments) => {
				if (!clinicGuard.isCurrent(clinicToken)) return;
				this.setData({ clinicDepartments, clinicError: "" });
			})
			.catch((error) => {
				if (!clinicGuard.isCurrent(clinicToken)) return;
				this.setData({
					clinicError: appointmentDirectoryErrorMessage(
						error,
						"细分门诊加载失败",
					),
				});
			})
			.finally(() => {
				if (clinicGuard.isCurrent(clinicToken)) {
					this.setData({ clinicLoading: false });
				}
			});
	},

	/**
	 * 旧项目 `scheduling-depts` 的三级门诊点击后进入独立号源页。
	 *
	 * route 只携带当前受控目录里的 opaque ID 与展示名；排班数据不跨页传递，
	 * 目标页会重新走已认证的 `/appointments/schedules` 边界。
	 */
	openClinicSchedule(clinic: AppointmentClinicDepartment): void {
		const currentClinic = this.data.clinicDepartments.find(
			(item) => item.departmentId === clinic.departmentId,
		);
		if (!currentClinic) return;
		wx.navigateTo({
			url: `/pages/appointment-schedule/appointment-schedule?departmentId=${encodeURIComponent(
				currentClinic.departmentId,
			)}&departmentName=${encodeURIComponent(currentClinic.displayName)}`,
		});
	},

	onRetry(): void {
		void this.loadDirectory();
	},

	onClinicRetry(): void {
		if (!this.data.selectedDepartmentId) return;
		void this.loadClinicDepartments(this.data.selectedDepartmentId);
	},

	/** 旧端顶部导诊入口保留位置，尚未开放的内容统一进入受控状态页。 */
	onGuideTap(): void {
		navigateToFeatureStatus("guide");
	},

	/** 输入只保留在当前目录，不把自由文本透传给 Provider。 */
	onSearchInput(event): void {
		const rawValue = event.detail?.value;
		const searchText =
			typeof rawValue === "string"
				? rawValue.replace(/[\r\n]/gu, "").slice(0, 32)
				: "";
		this.setData({ searchText });
	},

	/** 搜索仅定位当前已读取的一级、二级、三级目录。 */
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
				getPageLatestRequestGuard(this, "clinic").begin();
				this.setData({
					selectedDepartmentGroupId: departmentGroup.groupId,
					currentGroupDepartments: departmentGroup.departments,
					...resetExpandedClinicState(),
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
				getPageLatestRequestGuard(this, "clinic").begin();
				this.setData({
					selectedDepartmentGroupId: group.groupId,
					currentGroupDepartments: group.departments,
					...resetExpandedClinicState(),
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
			this.openClinicSchedule(clinic);
			return;
		}

		if (department) {
			wx.showToast({ title: "当前科室已展示", icon: "none" });
			return;
		}
		wx.showToast({ title: "未找到匹配的科室或门诊", icon: "none" });
	},

	/** 切换左侧一级分类，只更换二级列表，不发起虚构分类查询。 */
	onDepartmentGroupTap(event): void {
		const groupId = event.currentTarget?.dataset?.groupId;
		if (typeof groupId !== "string" || !groupId) return;
		const group = this.data.departmentGroups.find(
			(item) => item.groupId === groupId,
		);
		if (!group || group.groupId === this.data.selectedDepartmentGroupId) return;

		getPageLatestRequestGuard(this, "clinic").begin();
		this.setData({
			selectedDepartmentGroupId: group.groupId,
			currentGroupDepartments: group.departments,
			...resetExpandedClinicState(),
		});
	},

	onDepartmentTap(event): void {
		const departmentId = event.currentTarget?.dataset?.departmentId;
		if (typeof departmentId !== "string" || !departmentId) return;
		const department = this.data.departments.find(
			(item) => item.departmentId === departmentId,
		);
		// 刷新期间旧 WXML 事件可能晚到；必须先回查当前目录。
		if (!department) return;
		if (
			department.departmentId === this.data.selectedDepartmentId &&
			!this.data.clinicError
		) {
			getPageLatestRequestGuard(this, "clinic").begin();
			this.setData(resetExpandedClinicState());
			return;
		}
		void this.loadClinicDepartments(department.departmentId);
	},

	/** 三级门诊只能来自当前已加载目录，点击后跳转到独立的排班页。 */
	onClinicDepartmentTap(event): void {
		const clinicDepartmentId = event.currentTarget?.dataset?.clinicDepartmentId;
		if (typeof clinicDepartmentId !== "string" || !clinicDepartmentId) return;
		const clinic = this.data.clinicDepartments.find(
			(item) => item.departmentId === clinicDepartmentId,
		);
		if (!clinic) return;
		this.openClinicSchedule(clinic);
	},

	onPullDownRefresh(): void {
		this.loadDirectory().finally(() => wx.stopPullDownRefresh());
	},

	onUnload(): void {
		disposePageInstance(this);
	},
});
