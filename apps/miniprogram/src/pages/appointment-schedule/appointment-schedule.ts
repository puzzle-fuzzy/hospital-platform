import { ApiError, contextualApiErrorMessage } from "../../services/api-client";
import {
	buildAppointmentDateStrip,
	groupAppointmentDoctorCards,
	visibleAppointmentSchedules,
} from "../../services/appointment-directory-view";
import {
	createUpcomingDateRange,
	DASHBOARD_DATE_RANGE_DAYS,
	formatPlatformDate,
	loadAppointmentSchedules,
	loadAppointmentSchedulesForDate,
} from "../../services/dashboard-service";
import {
	disposePageInstance,
	getPageLatestRequestGuard,
} from "../../services/page-instance-state";
import type {
	AppointmentDoctorCard,
	AppointmentSchedule,
	AppointmentScheduleMode,
	AppointmentSchedulePageData,
} from "../../types";

/** 蓝狐旧端页面的本地首批渲染上限，不表示 Provider 分页。 */
const SCHEDULE_PAGE_SIZE = 12;

type AppointmentSchedulePageMethods = {
	loadDoctorSchedules(): Promise<void>;
	loadDateSchedules(
		workDate: string,
		doctorId?: string,
		doctorName?: string,
	): Promise<void>;
	selectDoctor(doctor: AppointmentDoctorCard, requestedDate?: string): void;
	onRetry(): void;
	onModeTap(event: WechatMiniprogram.TouchEvent): void;
	onDoctorCardTap(event: WechatMiniprogram.TouchEvent): void;
	onDoctorDateTap(event: WechatMiniprogram.TouchEvent): void;
	onDateTap(event: WechatMiniprogram.TouchEvent): void;
	onDatePickerChange(event: WechatMiniprogram.TouchEvent): void;
	onClearDoctorFilter(): void;
	onLoadMore(): void;
	onScheduleTap(event: WechatMiniprogram.TouchEvent): void;
	onPullDownRefresh(): void;
	onUnload(): void;
};

function isAppointmentScheduleMode(
	value: unknown,
): value is AppointmentScheduleMode {
	return value === "doctor" || value === "date";
}

/** 路由参数仅能承载当前目录输出的短 opaque ID 和展示名。 */
function isBoundedRouteValue(
	value: unknown,
	maxLength: number,
): value is string {
	return (
		typeof value === "string" &&
		value.length > 0 &&
		Array.from(value).length <= maxLength &&
		value === value.trim() &&
		!Array.from(value).some((character) => {
			const code = character.charCodeAt(0);
			return code <= 0x1f || code === 0x7f;
		})
	);
}

/**
 * 微信运行时通常会解码 query 参数，但开发者工具的部分入口会把
 * encodeURIComponent 的原始值交给页面；某些预览入口还会二次编码。
 * 因此只在路由边界最多解三层，避免把 `%E9...` 直接写进原生导航栏；
 * 畸形百分号编码则按无效路由处理。
 */
function decodeRouteValue(value: string | undefined): string | undefined {
	if (typeof value !== "string") return undefined;
	let decodedValue = value;
	for (let depth = 0; depth < 3; depth += 1) {
		if (!/%[0-9A-Fa-f]{2}/u.test(decodedValue)) break;
		try {
			const nextValue = decodeURIComponent(decodedValue);
			if (nextValue === decodedValue) break;
			decodedValue = nextValue;
		} catch {
			return undefined;
		}
	}
	return decodedValue;
}

function scheduleErrorMessage(error: unknown, fallback: string): string {
	if (!(error instanceof ApiError)) return fallback;
	return error.code === "dependency-not-configured"
		? "预约服务正在完善中，暂时无法使用"
		: contextualApiErrorMessage(error, "预约信息暂时无法获取，请稍后再试");
}

type DateSchedulePresentation = Pick<
	AppointmentSchedulePageData,
	"visibleSchedules" | "hasMoreSchedules" | "visibleScheduleCount"
>;

function createDateSchedulePresentation(
	schedules: readonly AppointmentSchedule[],
	selectedDate: string,
	selectedDoctorId: string,
	visibleCount: number,
): DateSchedulePresentation {
	const matchingSchedules = schedules.filter(
		(schedule) =>
			schedule.workDate === selectedDate &&
			(!selectedDoctorId || schedule.doctorId === selectedDoctorId),
	);
	return {
		visibleSchedules: visibleAppointmentSchedules(
			schedules,
			selectedDate,
			visibleCount,
			selectedDoctorId,
		),
		hasMoreSchedules: matchingSchedules.length > visibleCount,
		visibleScheduleCount: visibleCount,
	};
}

function isDateInPickerRange(
	workDate: unknown,
	startDate: string,
	endDate: string,
): workDate is string {
	return (
		typeof workDate === "string" &&
		/^\d{4}-\d{2}-\d{2}$/.test(workDate) &&
		workDate >= startDate &&
		workDate <= endDate
	);
}

/** 蓝狐筛选栏展示短日期；请求和 picker value 仍只使用完整医院工作日。 */
function formatDatePickerLabel(workDate: string): string {
	return /^\d{4}-\d{2}-\d{2}$/.test(workDate) ? workDate.slice(5) : workDate;
}

/**
 * 对应旧项目 `/pagesB/hospital/department_select`：三级门诊单独入页，
 * 默认“按医生挂号”，切换到“按日期挂号”后按选中自然日重新读取号源。
 */
Page<AppointmentSchedulePageData, AppointmentSchedulePageMethods>({
	data: {
		departmentId: "",
		departmentName: "",
		activeMode: "doctor",
		doctorSchedules: [],
		doctorCards: [],
		dateSchedules: [],
		selectedDoctorId: "",
		selectedDoctorName: "",
		selectedDateLabel: "",
		selectedDate: "",
		dateOptions: [],
		datePickerStart: "",
		datePickerEnd: "",
		visibleSchedules: [],
		hasMoreSchedules: false,
		visibleScheduleCount: SCHEDULE_PAGE_SIZE,
		loading: true,
		error: "",
	},

	onLoad(options: Record<string, string | undefined>) {
		const departmentId = decodeRouteValue(options.departmentId);
		const departmentName = decodeRouteValue(options.departmentName);
		if (
			!isBoundedRouteValue(departmentId, 128) ||
			!isBoundedRouteValue(departmentName, 128)
		) {
			this.setData({
				loading: false,
				error: "门诊参数无效，请返回重新选择细分门诊",
			});
			return;
		}

		const now = new Date();
		const datePickerStart = formatPlatformDate(now);
		const datePickerEnd = createUpcomingDateRange(
			DASHBOARD_DATE_RANGE_DAYS.appointmentScheduleCalendar,
			now,
		).endDate;
		this.setData({
			departmentId,
			departmentName,
			selectedDate: datePickerStart,
			selectedDateLabel: formatDatePickerLabel(datePickerStart),
			dateOptions: buildAppointmentDateStrip(datePickerStart, 6, datePickerEnd),
			datePickerStart,
			datePickerEnd,
		});
		wx.setNavigationBarTitle({ title: departmentName });
		void this.loadDoctorSchedules();
	},

	/** 默认按医生读取未来七天；不把目录页旧排班跨页面复用。 */
	loadDoctorSchedules(): Promise<void> {
		if (!this.data.departmentId) return Promise.resolve();
		const guard = getPageLatestRequestGuard(this, "appointment-schedule");
		const token = guard.begin();
		this.setData({
			activeMode: "doctor",
			loading: true,
			error: "",
			doctorSchedules: [],
			doctorCards: [],
			// 两个页签的默认语义彼此独立：回到“按医生”即取消此前医生
			// 卡片带入的日期筛选；之后再切“按日期”应恢复整个门诊的号源。
			selectedDoctorId: "",
			selectedDoctorName: "",
			dateSchedules: [],
			visibleSchedules: [],
			hasMoreSchedules: false,
			visibleScheduleCount: SCHEDULE_PAGE_SIZE,
		});
		return loadAppointmentSchedules(this.data.departmentId)
			.then((doctorSchedules) => {
				if (!guard.isCurrent(token)) return;
				this.setData({
					doctorSchedules,
					doctorCards: groupAppointmentDoctorCards(doctorSchedules),
				});
			})
			.catch((error) => {
				if (!guard.isCurrent(token)) return;
				this.setData({
					error: scheduleErrorMessage(error, "医生排班加载失败"),
				});
			})
			.finally(() => {
				if (guard.isCurrent(token)) this.setData({ loading: false });
			});
	},

	/** 按日期挂号只请求选中工作日；可选医生 ID 来自当前医生卡片。 */
	loadDateSchedules(
		workDate: string,
		doctorId = "",
		doctorName = "",
	): Promise<void> {
		if (
			!this.data.departmentId ||
			!isDateInPickerRange(
				workDate,
				this.data.datePickerStart,
				this.data.datePickerEnd,
			)
		) {
			return Promise.resolve();
		}
		const guard = getPageLatestRequestGuard(this, "appointment-schedule");
		const token = guard.begin();
		const dateOptions = buildAppointmentDateStrip(
			workDate,
			6,
			this.data.datePickerEnd,
		);
		this.setData({
			activeMode: "date",
			loading: true,
			error: "",
			selectedDate: workDate,
			selectedDateLabel: formatDatePickerLabel(workDate),
			dateOptions,
			dateSchedules: [],
			visibleSchedules: [],
			hasMoreSchedules: false,
			visibleScheduleCount: SCHEDULE_PAGE_SIZE,
			selectedDoctorId: doctorId,
			selectedDoctorName: doctorName,
		});
		return loadAppointmentSchedulesForDate(
			this.data.departmentId,
			workDate,
			doctorId,
		)
			.then((dateSchedules) => {
				if (!guard.isCurrent(token)) return;
				this.setData({
					dateSchedules,
					...createDateSchedulePresentation(
						dateSchedules,
						workDate,
						doctorId,
						SCHEDULE_PAGE_SIZE,
					),
				});
			})
			.catch((error) => {
				if (!guard.isCurrent(token)) return;
				this.setData({
					error: scheduleErrorMessage(error, "当日排班加载失败"),
				});
			})
			.finally(() => {
				if (guard.isCurrent(token)) this.setData({ loading: false });
			});
	},

	onRetry(): void {
		if (this.data.activeMode === "date") {
			void this.loadDateSchedules(
				this.data.selectedDate,
				this.data.selectedDoctorId,
				this.data.selectedDoctorName,
			);
			return;
		}
		void this.loadDoctorSchedules();
	},

	onModeTap(event): void {
		const mode = event.currentTarget?.dataset?.mode;
		if (!isAppointmentScheduleMode(mode)) return;
		if (mode === "doctor") {
			void this.loadDoctorSchedules();
			return;
		}
		void this.loadDateSchedules(
			this.data.selectedDate,
			this.data.selectedDoctorId,
			this.data.selectedDoctorName,
		);
	},

	/** 医生卡进入统一医生名片，名片继续承接关注和排班查看。 */
	onDoctorCardTap(event): void {
		const doctorId = event.currentTarget?.dataset?.doctorId;
		if (typeof doctorId !== "string" || !doctorId) return;
		const doctor = this.data.doctorCards.find(
			(item) => item.doctorId === doctorId,
		);
		if (!doctor) return;
		wx.navigateTo({
			url:
				"/pages/my-doctor-detail/my-doctor-detail?doctorId=" +
				encodeURIComponent(doctor.doctorId),
		});
	},

	onDoctorDateTap(event): void {
		const doctorId = event.currentTarget?.dataset?.doctorId;
		const workDate = event.currentTarget?.dataset?.date;
		if (
			typeof doctorId !== "string" ||
			!doctorId ||
			typeof workDate !== "string" ||
			!workDate
		) {
			return;
		}
		const doctor = this.data.doctorCards.find(
			(item) => item.doctorId === doctorId,
		);
		if (!doctor?.dates.some((item) => item.workDate === workDate)) return;
		this.selectDoctor(doctor, workDate);
	},

	selectDoctor(doctor: AppointmentDoctorCard, requestedDate = ""): void {
		const currentDoctor = this.data.doctorCards.find(
			(item) => item.doctorId === doctor.doctorId,
		);
		if (!currentDoctor) return;
		const selectedDate =
			requestedDate ||
			currentDoctor.dates.find((item) => item.availableSlots > 0)?.workDate ||
			currentDoctor.dates[0]?.workDate ||
			this.data.selectedDate;
		void this.loadDateSchedules(
			selectedDate,
			currentDoctor.doctorId,
			currentDoctor.doctorName,
		);
	},

	onDateTap(event): void {
		const workDate = event.currentTarget?.dataset?.date;
		if (
			!isDateInPickerRange(
				workDate,
				this.data.datePickerStart,
				this.data.datePickerEnd,
			) ||
			!this.data.dateOptions.some((item) => item.workDate === workDate)
		) {
			return;
		}
		void this.loadDateSchedules(
			workDate,
			this.data.selectedDoctorId,
			this.data.selectedDoctorName,
		);
	},

	onDatePickerChange(event): void {
		const workDate = event.detail?.value;
		if (
			!isDateInPickerRange(
				workDate,
				this.data.datePickerStart,
				this.data.datePickerEnd,
			)
		) {
			return;
		}
		void this.loadDateSchedules(
			workDate,
			this.data.selectedDoctorId,
			this.data.selectedDoctorName,
		);
	},

	onClearDoctorFilter(): void {
		if (!this.data.selectedDoctorId) return;
		void this.loadDateSchedules(this.data.selectedDate);
	},

	onLoadMore(): void {
		if (this.data.loading || !this.data.hasMoreSchedules) return;
		const matchingCount = this.data.dateSchedules.filter(
			(schedule) =>
				schedule.workDate === this.data.selectedDate &&
				(!this.data.selectedDoctorId ||
					schedule.doctorId === this.data.selectedDoctorId),
		).length;
		const nextCount = Math.min(
			this.data.visibleScheduleCount + SCHEDULE_PAGE_SIZE,
			matchingCount,
		);
		if (nextCount <= this.data.visibleScheduleCount) return;
		this.setData({
			...createDateSchedulePresentation(
				this.data.dateSchedules,
				this.data.selectedDate,
				this.data.selectedDoctorId,
				nextCount,
			),
		});
	},

	/** 只允许当前可见、仍有余号的排班进入分时段号源只读页。 */
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
		wx.navigateTo({
			url: `/pages/timeslot-source/timeslot-source?scheduleId=${encodeURIComponent(scheduleId)}`,
		});
	},

	onPullDownRefresh(): void {
		const request =
			this.data.activeMode === "date"
				? this.loadDateSchedules(
						this.data.selectedDate,
						this.data.selectedDoctorId,
						this.data.selectedDoctorName,
					)
				: this.loadDoctorSchedules();
		request.finally(() => wx.stopPullDownRefresh());
	},

	onUnload(): void {
		disposePageInstance(this);
	},
});
