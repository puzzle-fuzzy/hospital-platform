import {
	ApiError,
	contextualApiErrorMessage,
	requestAppointmentSchedules,
	requestMyDoctorFollow,
	requestMyDoctorUnfollow,
	requestMyDoctors,
} from "../../services/api-client";
import {
	createUpcomingDateRange,
	DASHBOARD_DATE_RANGE_DAYS,
} from "../../services/dashboard-service";
import {
	disposePageInstance,
	getPageLatestRequestGuard,
} from "../../services/page-instance-state";
import type {
	AppointmentSchedule,
	MyDoctorDetailPageData,
	MyDoctorDetailView,
} from "../../types";

type MyDoctorDetailPageMethods = {
	loadDetail(): Promise<void>;
	onDateTap(event: WechatMiniprogram.TouchEvent): void;
	onFollowTap(): void;
	onScheduleTap(event: WechatMiniprogram.TouchEvent): void;
	onRetry(): void;
	onPullDownRefresh(): void;
	onUnload(): void;
};

const WEEKDAY_LABELS = [
	"周日",
	"周一",
	"周二",
	"周三",
	"周四",
	"周五",
	"周六",
] as const;

function decodeRouteValue(value: string | undefined): string {
	if (typeof value !== "string") return "";
	let decoded = value;
	for (let index = 0; index < 3 && /%[0-9a-f]{2}/iu.test(decoded); index += 1) {
		try {
			const next = decodeURIComponent(decoded);
			if (next === decoded) break;
			decoded = next;
		} catch {
			return "";
		}
	}
	return decoded.trim();
}

function validDoctorId(value: string): boolean {
	return (
		value.length > 0 &&
		value.length <= 128 &&
		!Array.from(value).some((character) => {
			const code = character.charCodeAt(0);
			return code <= 0x1f || code === 0x7f;
		})
	);
}

function dateOptions(schedules: readonly AppointmentSchedule[]) {
	const dates = [
		...new Set(schedules.map((schedule) => schedule.workDate)),
	].sort();
	return dates.map((workDate) => {
		const date = new Date(`${workDate}T00:00:00.000Z`);
		return {
			workDate,
			dateLabel: workDate.slice(5),
			weekdayLabel: Number.isNaN(date.getTime())
				? ""
				: (WEEKDAY_LABELS[date.getUTCDay()] ?? ""),
		};
	});
}

function detailErrorMessage(error: unknown): string {
	if (error instanceof ApiError && error.code === "my-doctor-not-found") {
		return "暂未查询到该医生的最新信息，请返回预约目录重新选择";
	}
	return contextualApiErrorMessage(error, "医生信息暂时无法获取，请稍后再试");
}

function doctorFromSchedule(schedule: AppointmentSchedule): MyDoctorDetailView {
	return {
		doctorId: schedule.doctorId,
		doctorName: schedule.doctorName,
		...(schedule.titleName ? { titleName: schedule.titleName } : {}),
		...(schedule.introduction ? { introduction: schedule.introduction } : {}),
		...(schedule.expertise ? { expertise: schedule.expertise } : {}),
		...(schedule.departmentLocation
			? { departmentLocation: schedule.departmentLocation }
			: {}),
		departmentName: schedule.departmentName,
		...(schedule.doctorPhotoUrl
			? { doctorAvatarUrl: schedule.doctorPhotoUrl }
			: {}),
	};
}

function visibleForDate(
	schedules: readonly AppointmentSchedule[],
	workDate: string,
): Array<AppointmentSchedule> {
	return schedules.filter((schedule) => schedule.workDate === workDate);
}

Page<MyDoctorDetailPageData, MyDoctorDetailPageMethods>({
	data: {
		doctorId: "",
		doctor: null,
		schedules: [],
		visibleSchedules: [],
		dateOptions: [],
		selectedDate: "",
		followed: false,
		loading: true,
		scheduleLoading: true,
		actionLoading: false,
		error: "",
	},

	onLoad(options: Record<string, string | undefined>) {
		const doctorId = decodeRouteValue(options.doctorId);
		if (!validDoctorId(doctorId)) {
			this.setData({
				loading: false,
				scheduleLoading: false,
				error: "医生链接已失效，请返回预约目录重新选择",
			});
			return;
		}
		this.setData({ doctorId });
		void this.loadDetail();
	},

	loadDetail(): Promise<void> {
		if (!this.data.doctorId) return Promise.resolve();
		const guard = getPageLatestRequestGuard(this, "my-doctor-detail");
		const token = guard.begin();
		this.setData({
			loading: true,
			scheduleLoading: true,
			error: "",
		});
		const range = createUpcomingDateRange(
			DASHBOARD_DATE_RANGE_DAYS.appointmentDirectory,
		);
		return Promise.all([
			requestMyDoctors(),
			requestAppointmentSchedules({ ...range, doctorId: this.data.doctorId }),
		])
			.then(([followedPayload, schedulePayload]) => {
				if (!guard.isCurrent(token)) return;
				const schedules = schedulePayload.data.items.filter(
					(schedule) => schedule.doctorId === this.data.doctorId,
				);
				const followedDoctor = followedPayload.data.items.find(
					(doctor) => doctor.doctorId === this.data.doctorId,
				);
				const doctor =
					followedDoctor ??
					(schedules[0] ? doctorFromSchedule(schedules[0]) : undefined);
				if (!doctor)
					throw new ApiError("医生不存在", { code: "my-doctor-not-found" });
				const options = dateOptions(schedules);
				const selectedDate =
					options.find((item) =>
						schedules.some(
							(schedule) =>
								schedule.workDate === item.workDate &&
								schedule.availableSlots > 0,
						),
					)?.workDate ??
					options[0]?.workDate ??
					"";
				this.setData({
					doctor,
					schedules,
					visibleSchedules: visibleForDate(schedules, selectedDate),
					dateOptions: options,
					selectedDate,
					followed: Boolean(followedDoctor),
					error: "",
				});
			})
			.catch((error: unknown) => {
				if (!guard.isCurrent(token)) return;
				this.setData({
					doctor: null,
					schedules: [],
					visibleSchedules: [],
					dateOptions: [],
					error: detailErrorMessage(error),
				});
			})
			.finally(() => {
				if (!guard.isCurrent(token)) return;
				this.setData({ loading: false, scheduleLoading: false });
			});
	},

	onDateTap(event): void {
		const workDate = event.currentTarget?.dataset?.date;
		if (
			typeof workDate !== "string" ||
			!this.data.dateOptions.some((item) => item.workDate === workDate)
		) {
			return;
		}
		this.setData({
			selectedDate: workDate,
			visibleSchedules: visibleForDate(this.data.schedules, workDate),
		});
	},

	onFollowTap(): void {
		if (this.data.actionLoading || !this.data.doctorId) return;
		const wasFollowed = this.data.followed;
		this.setData({ actionLoading: true });
		const request = wasFollowed
			? requestMyDoctorUnfollow(this.data.doctorId)
			: requestMyDoctorFollow(this.data.doctorId);
		request
			.then(() => {
				if (wasFollowed) {
					this.setData({ followed: false });
					wx.showToast({ title: "取消关注成功", icon: "success" });
					return;
				}
				this.setData({ followed: true });
				wx.showToast({ title: "关注成功", icon: "success" });
			})
			.catch((error: unknown) => {
				wx.showToast({
					title: contextualApiErrorMessage(error, "操作失败，请稍后再试"),
					icon: "none",
				});
			})
			.finally(() => this.setData({ actionLoading: false }));
	},

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
			url:
				"/pages/timeslot-source/timeslot-source?scheduleId=" +
				encodeURIComponent(schedule.scheduleId),
		});
	},

	onRetry(): void {
		if (!this.data.loading) void this.loadDetail();
	},

	onPullDownRefresh(): void {
		this.loadDetail().finally(() => wx.stopPullDownRefresh());
	},

	onUnload(): void {
		disposePageInstance(this);
	},
});
