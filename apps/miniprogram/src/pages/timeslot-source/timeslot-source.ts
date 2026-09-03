import {
	ApiError,
	contextualApiErrorMessage,
	requestAppointmentScheduleSources,
} from "../../services/api-client";
import {
	disposePageInstance,
	getPageLatestRequestGuard,
} from "../../services/page-instance-state";
import type {
	AppointmentSchedule,
	AppointmentScheduleSource,
	TimeslotSourcePageData,
} from "../../types";

type TimeslotSourcePageMethods = {
	loadSources(): Promise<void>;
	onSlotTap(event: WechatMiniprogram.TouchEvent): void;
	onRetry(): void;
	onPullDownRefresh(): void;
	onUnload(): void;
};

/**
 * 对应旧项目 `/pagesB/hospital/timeslot_source`。
 *
 * 旧端同时请求排班详情和号源明细，并展示 provider 挂号费；新端只消费
 * 服务端白名单后的排班展示上下文与分时段号源，不展示费用，也不把
 * provider 号源 ID 拼进后续路由——写入合同在服务端重新解析号源。
 */
Page<TimeslotSourcePageData, TimeslotSourcePageMethods>({
	data: {
		scheduleId: "",
		schedule: null,
		slots: [],
		loading: true,
		error: "",
	},

	onLoad(options: Record<string, string | undefined>) {
		const scheduleId =
			typeof options.scheduleId === "string" ? options.scheduleId.trim() : "";
		if (!scheduleId || scheduleId.length > 128) {
			this.setData({
				loading: false,
				error: "排班引用无效，请返回重新选择医生排班",
			});
			return;
		}
		this.setData({ scheduleId });
		void this.loadSources();
	},

	loadSources(): Promise<void> {
		if (!this.data.scheduleId) return Promise.resolve();
		const guard = getPageLatestRequestGuard(this, "timeslot-source");
		const token = guard.begin();
		this.setData({ loading: true, error: "" });
		return requestAppointmentScheduleSources(this.data.scheduleId)
			.then((payload) => {
				if (!guard.isCurrent(token)) return;
				this.setData({
					schedule: payload.data.schedule,
					slots: payload.data.items,
				});
			})
			.catch((error: unknown) => {
				if (!guard.isCurrent(token)) return;
				this.setData({
					error: timeslotErrorMessage(error),
					schedule: null,
					slots: [],
				});
			})
			.finally(() => {
				if (guard.isCurrent(token)) this.setData({ loading: false });
			});
	},

	/** 选择时段只携带展示事实进入确认页；provider 号源 ID 不进路由。 */
	onSlotTap(event): void {
		const index = event.currentTarget?.dataset?.index;
		if (typeof index !== "number" && typeof index !== "string") return;
		const slot: AppointmentScheduleSource | undefined =
			this.data.slots[Number(index)];
		const schedule: AppointmentSchedule | null = this.data.schedule;
		if (!slot || !schedule) return;
		const query = [
			`scheduleId=${encodeURIComponent(this.data.scheduleId)}`,
			`departmentName=${encodeURIComponent(schedule.departmentName)}`,
			`doctorName=${encodeURIComponent(schedule.doctorName)}`,
			`workDate=${encodeURIComponent(schedule.workDate)}`,
			`shiftName=${encodeURIComponent(schedule.shiftName)}`,
			`timeLabel=${encodeURIComponent(slot.timeLabel)}`,
			`serialNumber=${encodeURIComponent(slot.serialNumber)}`,
		].join("&");
		wx.navigateTo({
			url: `/pages/confirm-registration/confirm-registration?${query}`,
		});
	},

	onRetry(): void {
		if (!this.data.loading) void this.loadSources();
	},

	onPullDownRefresh(): void {
		this.loadSources().finally(() => wx.stopPullDownRefresh());
	},

	onUnload(): void {
		disposePageInstance(this);
	},
});

function timeslotErrorMessage(error: unknown): string {
	if (error instanceof ApiError) {
		if (error.code === "appointment-schedule-reference-expired") {
			return "排班信息已更新，请返回重新选择";
		}
		if (error.code === "dependency-not-configured") {
			return "预约服务正在完善中，暂时无法使用";
		}
		return contextualApiErrorMessage(error, "号源信息暂时无法获取，请稍后再试");
	}
	return "号源信息暂时无法获取，请稍后再试";
}
