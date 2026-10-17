import {
	ApiError,
	contextualApiErrorMessage,
	createIdempotencyKey,
	requestAppointmentCancellation,
	requestAppointmentHold,
	requestAppointmentRegistration,
	requestAppointmentScheduleSources,
} from "../../services/api-client";
import {
	sameRebookingSchedule,
	selectRebookingSchedule,
	unchangedRebookingSource,
} from "../../services/appointment-rebooking";
import {
	loadAppointmentSchedulesForDate,
	loadCurrentPatient,
	requireAppointmentScheduleSourceListData,
} from "../../services/dashboard-service";
import { errorMessageWithCode } from "../../services/error-presentation";
import {
	disposePageInstance,
	getPageLatestRequestGuard,
} from "../../services/page-instance-state";
import { isCurrentSelectedPatient } from "../../services/patient-selection-service";
import {
	disposePageSessionResetListener,
	registerPageSessionResetListener,
} from "../../services/session-events";
import {
	getSessionGeneration,
	isCurrentSessionGeneration,
} from "../../services/session-generation";
import { logClientErrorTransformed } from "../../services/telemetry";
import type { ConfirmRegistrationPageData } from "../../types";

type ConfirmRegistrationPageMethods = {
	loadPatient(): void;
	onOpenPatientSelector(): void;
	onToggleAgree(): void;
	onOpenNotice(): void;
	onConfirmTap(): void;
	submitRegistration(recoverSources?: boolean): void;
	onCancelAndRetry(): void;
	loadSourceContext(): Promise<void>;
	refreshSources(autoContinue?: boolean): Promise<void>;
	onRefreshSources(): void;
	onSourceChoiceTap(event: WechatMiniprogram.TouchEvent): void;
	onUnload(): void;
};

/** 须知不复制旧端模板中的外院电话；取消/取号规则以医院现场公示为准。 */
const REGISTRATION_NOTICE = [
	"1、请确认就诊日期与时段后继续；当日挂号以医院实际安排为准。",
	"2、医院实行实名制就诊，请携带有效证件按时到院取号候诊。",
	"3、未按时取号的预约可能按爽约处理；取消规则以医院现场公示为准。",
	"4、挂号费用以下单时医院实际收费为准，本页面不展示报价。",
].join("\n");

/**
 * 对应旧项目 `/pagesB/hospital/confirm_registration`。
 *
 * 旧端在此页拼接 provider 号源 ID、挂号费并直接调用执行预约接口；新端
 * 只提交服务端签发的 scheduleId、号源序号和平台 patientId。锁号、费用、
 * Provider 患者映射与预约写入由服务端完成；就诊人证件、手机号等敏感字段
 * 不进入本页。
 */
Page<ConfirmRegistrationPageData, ConfirmRegistrationPageMethods>({
	data: {
		hospitalName: "高平市人民医院",
		scheduleId: "",
		departmentId: "",
		doctorId: "",
		sourceSchedule: null,
		sourceTimeGroup: "",
		refreshingSources: false,
		sourceChoices: [],
		sourceSelectionRequired: false,
		sourceNotice: "",
		originalAppointmentCancelled: false,
		departmentName: "",
		registrationClassName: "",
		hospitalAreaName: "",
		doctorName: "",
		workDate: "",
		shiftName: "",
		timeLabel: "",
		serialNumber: "",
		patientId: "",
		patientName: "",
		patientCardLabel: "",
		patientLoading: true,
		agreed: false,
		submitting: false,
		holdId: "",
		holdIdempotencyKey: "",
		registrationIdempotencyKey: "",
		duplicate: null,
		error: "",
	},

	onLoad(options: Record<string, string | undefined>) {
		this.setData({
			scheduleId: decodeRouteValue(options.scheduleId) ?? "",
			departmentId: boundedRouteId(options.departmentId),
			doctorId: boundedRouteId(options.doctorId),
			sourceTimeGroup:
				options.sourceTimeGroup === "point" ||
				options.sourceTimeGroup === "range"
					? options.sourceTimeGroup
					: "",
			departmentName: decodeRouteValue(options.departmentName) ?? "",
			registrationClassName:
				decodeRouteValue(options.registrationClassName) ?? "",
			hospitalAreaName: decodeRouteValue(options.hospitalAreaName) ?? "",
			doctorName: decodeRouteValue(options.doctorName) ?? "",
			workDate: decodeRouteValue(options.workDate) ?? "",
			shiftName: decodeRouteValue(options.shiftName) ?? "",
			timeLabel: decodeRouteValue(options.timeLabel) ?? "",
			serialNumber: decodeRouteValue(options.serialNumber) ?? "",
		});
		if (
			!this.data.scheduleId ||
			!this.data.departmentName ||
			!this.data.doctorName ||
			!/^\d{4}-\d{2}-\d{2}$/.test(this.data.workDate) ||
			!this.data.timeLabel
		) {
			wx.showToast({ title: "预约信息无效，请重新选择", icon: "none" });
			setTimeout(() => wx.navigateBack(), 600);
			return;
		}
		registerPageSessionResetListener(
			this,
			() => {
				this.setData({
					patientId: "",
					patientName: "未选择就诊人",
					patientCardLabel: "请先选择就诊人",
					patientLoading: false,
					submitting: false,
					refreshingSources: false,
					holdId: "",
					holdIdempotencyKey: "",
					registrationIdempotencyKey: "",
					duplicate: null,
					originalAppointmentCancelled: false,
					error: "",
				});
			},
			() => this.loadPatient(),
		);
		this.loadPatient();
	},

	onShow() {
		// 从统一就诊人选择页返回后重新确认，不沿用上一位就诊人卡片。
		if (
			!this.data.patientLoading &&
			!this.data.submitting &&
			!this.data.refreshingSources
		)
			this.loadPatient();
	},

	loadPatient(): void {
		const guard = getPageLatestRequestGuard(this, "registration-patient");
		const token = guard.begin();
		const session = getSessionGeneration();
		const current = () =>
			guard.isCurrent(token) && isCurrentSessionGeneration(session);
		this.setData({ patientLoading: true });
		loadCurrentPatient()
			.then((patient) => {
				if (!current() || !isCurrentSelectedPatient(patient.id)) return;
				const patientChanged =
					Boolean(this.data.patientId) && this.data.patientId !== patient.id;
				if (patientChanged) {
					getPageLatestRequestGuard(this, "registration-command").begin();
					getPageLatestRequestGuard(this, "registration-sources").begin();
				}
				this.setData({
					patientId: patient.id,
					patientName: patient.displayName,
					patientCardLabel:
						patient.cardNumberMasked === "未绑定"
							? "就诊卡未绑定"
							: `就诊卡：${patient.cardNumberMasked}`,
					...(patientChanged
						? {
								holdId: "",
								holdIdempotencyKey: "",
								registrationIdempotencyKey: "",
								duplicate: null,
								originalAppointmentCancelled: false,
								submitting: false,
								refreshingSources: false,
							}
						: {}),
				});
				if (!this.data.sourceSchedule) void this.loadSourceContext();
			})
			.catch((error: unknown) => {
				if (!current()) return;
				// 就诊人上下文失败被静态文案替代；转换前留痕真实原因。
				logClientErrorTransformed(
					"confirm-registration.patient-context",
					error,
				);
				this.setData({
					patientId: "",
					patientName: "未选择就诊人",
					patientCardLabel: "请先选择就诊人",
					holdId: "",
					holdIdempotencyKey: "",
					registrationIdempotencyKey: "",
					duplicate: null,
				});
			})
			.finally(() => {
				if (current()) this.setData({ patientLoading: false });
			});
	},

	onOpenPatientSelector(): void {
		if (this.data.submitting || this.data.refreshingSources) return;
		wx.navigateTo({ url: "/pages/patient-select/patient-select" });
	},

	onToggleAgree(): void {
		this.setData({ agreed: !this.data.agreed });
	},

	onOpenNotice(): void {
		wx.showModal({
			title: "预约挂号须知",
			content: REGISTRATION_NOTICE,
			showCancel: false,
			confirmText: "我知道了",
		});
	},

	/**
	 * 预约写入采用“占位 → 注册”两步命令。
	 *
	 * 两个幂等键和 holdId 只保留在当前页面实例：注册请求超时后再次点击会
	 * 复用同一占位和同一注册幂等键，避免 Provider 已成功但客户端未收到响应
	 * 时产生第二次挂号。预约写入成功后进入正式小程序的挂号支付页；医保授权、
	 * 医保支付、微信支付和最终回写都由后续支付页继续处理。
	 */
	onConfirmTap(): void {
		if (
			this.data.submitting ||
			this.data.refreshingSources ||
			this.data.patientLoading
		)
			return;
		if (this.data.sourceSelectionRequired) {
			wx.showToast({ title: "请先选择最新可用时段", icon: "none" });
			return;
		}
		if (!this.data.agreed) {
			wx.showToast({ title: "请先阅读并同意预约挂号须知", icon: "none" });
			return;
		}
		if (!this.data.patientId || this.data.patientName === "未选择就诊人") {
			wx.showToast({ title: "请先选择就诊人", icon: "none" });
			return;
		}
		if (!this.data.scheduleId || !this.data.serialNumber) {
			wx.showToast({ title: "预约号源已失效，请返回重新选择", icon: "none" });
			return;
		}

		this.setData({ duplicate: null });
		this.submitRegistration();
	},

	/**
	 * 预约写入的可重试主体。重复预约取消成功后复用同一入口，确保重新
	 * 取号、锁号和支付上下文都从服务端重新开始。
	 */
	submitRegistration(recoverSources = true): void {
		if (
			!this.data.patientId ||
			this.data.patientLoading ||
			!isCurrentSelectedPatient(this.data.patientId)
		)
			return;
		const guard = getPageLatestRequestGuard(this, "registration-command");
		const token = guard.begin();
		const patientId = this.data.patientId;
		const session = getSessionGeneration();
		const current = () =>
			guard.isCurrent(token) &&
			this.data.patientId === patientId &&
			isCurrentSelectedPatient(patientId) &&
			isCurrentSessionGeneration(session);
		const holdIdempotencyKey =
			this.data.holdIdempotencyKey || createIdempotencyKey("appointment-hold");
		const registrationIdempotencyKey =
			this.data.registrationIdempotencyKey ||
			createIdempotencyKey("appointment-register");
		this.setData({
			submitting: true,
			error: "",
			holdIdempotencyKey,
			registrationIdempotencyKey,
		});

		let holdCompleted = Boolean(this.data.holdId);
		void (async () => {
			let holdId = this.data.holdId;
			if (!holdId) {
				const hold = await requestAppointmentHold(
					{
						patientId,
						scheduleId: this.data.scheduleId,
						sourceSerialNumber: this.data.serialNumber,
					},
					holdIdempotencyKey,
				);
				if (!current()) return;
				holdId = hold.data.holdId;
				holdCompleted = true;
				this.setData({ holdId });
			}
			const registration = await requestAppointmentRegistration(
				{ patientId, holdId },
				registrationIdempotencyKey,
			);
			if (!current()) return;
			if (registration.data.status === "duplicate") {
				// 不能把 duplicate 当 booked 继续跳支付；保留原预约信息，
				// 只有明确取消成功后才允许再次取号和写入。
				this.setData({
					submitting: false,
					holdId: "",
					holdIdempotencyKey: "",
					registrationIdempotencyKey: "",
					duplicate: registration.data,
					error: "",
				});
				return;
			}
			this.setData({ submitting: false, holdId: "", error: "" });
			const query =
				`patientId=${encodeURIComponent(registration.data.patientId)}` +
				`&appointmentId=${encodeURIComponent(registration.data.appointmentId)}`;
			wx.redirectTo({
				url: `/pages/registration-payment/registration-payment?${query}`,
				fail: () =>
					wx.navigateTo({
						url: `/pages/registration-payment/registration-payment?${query}`,
					}),
			});
		})().catch((error: unknown) => {
			if (!current()) return;
			// 只有锁号前的明确拒绝可换引用和幂等键；超时/未知结果必须保留原请求。
			if (!holdCompleted && isSourceChangedError(error)) {
				this.setData({
					submitting: false,
					holdIdempotencyKey: "",
					registrationIdempotencyKey: "",
					sourceSelectionRequired: true,
					sourceNotice: "号源再次发生变化，请在此刷新最新时段后继续",
				});
				if (recoverSources) void this.refreshSources(true);
				return;
			}
			const message = contextualApiErrorMessage(
				error,
				"预约暂时无法完成，请稍后重试",
			);
			this.setData({
				submitting: false,
				error: errorMessageWithCode(error, message),
			});
			logClientErrorTransformed("confirm-registration.submit", error);
		});
	},

	onCancelAndRetry(): void {
		const duplicate = this.data.duplicate;
		if (
			!duplicate ||
			this.data.submitting ||
			this.data.refreshingSources ||
			!this.data.patientId ||
			!isCurrentSelectedPatient(this.data.patientId) ||
			this.data.patientLoading
		)
			return;
		const guard = getPageLatestRequestGuard(this, "registration-command");
		const token = guard.begin();
		const patientId = this.data.patientId;
		const session = getSessionGeneration();
		const current = () =>
			guard.isCurrent(token) &&
			this.data.patientId === patientId &&
			isCurrentSelectedPatient(patientId) &&
			isCurrentSessionGeneration(session);
		// 打开确认框即锁定，防止连点产生多个取消请求。
		this.setData({ submitting: true, error: "" });
		let cancellationRequested = false;
		wx.showModal({
			title: "确认取消并重新预约？",
			content:
				"将先取消当前已有预约。取消成功后，系统会重新核验号源、重新预约，再进入支付；取消失败时会保留原预约。",
			confirmText: "确认继续",
			success: (result) => {
				if (!current() || cancellationRequested) return;
				if (!result.confirm) {
					this.setData({ submitting: false });
					return;
				}
				cancellationRequested = true;
				void requestAppointmentCancellation(duplicate.appointmentId)
					.then(() => {
						if (!current()) return;
						this.setData({
							duplicate: null,
							originalAppointmentCancelled: true,
							holdId: "",
							holdIdempotencyKey: "",
							registrationIdempotencyKey: "",
							submitting: false,
							sourceSelectionRequired: true,
							sourceNotice: "原预约已取消，正在核验最新号源…",
						});
						return this.refreshSources(true);
					})
					.catch((error: unknown) => {
						if (!current()) return;
						const message = contextualApiErrorMessage(
							error,
							"原预约取消失败，请勿重复预约；请稍后重试",
						);
						this.setData({
							submitting: false,
							error: errorMessageWithCode(error, message),
						});
						logClientErrorTransformed(
							"confirm-registration.cancel-duplicate",
							error,
						);
					});
			},
			fail: () => {
				if (current() && !cancellationRequested)
					this.setData({ submitting: false });
			},
		});
	},

	/** 初次读取只补齐受控排班身份，绝不因只读完成自动发起预约。 */
	async loadSourceContext(): Promise<void> {
		const guard = getPageLatestRequestGuard(this, "registration-sources");
		const token = guard.begin();
		const session = getSessionGeneration();
		const patientId = this.data.patientId;
		try {
			const payload = await requestAppointmentScheduleSources(
				this.data.scheduleId,
			);
			if (
				!guard.isCurrent(token) ||
				!isCurrentSessionGeneration(session) ||
				!isCurrentSelectedPatient(patientId) ||
				this.data.patientId !== patientId
			)
				return;
			const sources = requireAppointmentScheduleSourceListData(payload.data);
			if (
				sources.schedule.scheduleId !== this.data.scheduleId ||
				!matchesRouteSchedule(sources.schedule, this.data)
			)
				return;
			const original = sources.items.find(
				(slot) =>
					slot.serialNumber === this.data.serialNumber &&
					slot.timeLabel === this.data.timeLabel,
			);
			this.setData({
				departmentId: sources.schedule.departmentId,
				doctorId: sources.schedule.doctorId,
				sourceSchedule: sources.schedule,
				...(original ? { sourceTimeGroup: original.timeGroup } : {}),
			});
		} catch {
			// 短期引用过期时由明确重试路径刷新；这里不覆盖患者或预约结果。
		}
	},

	/** 只读刷新严格保留原医生和就诊安排，时间变化时留在本页供用户确认。 */
	async refreshSources(autoContinue = false): Promise<void> {
		if (
			this.data.holdId ||
			this.data.holdIdempotencyKey ||
			this.data.registrationIdempotencyKey ||
			this.data.refreshingSources ||
			!this.data.patientId ||
			!isCurrentSelectedPatient(this.data.patientId)
		)
			return;
		const guard = getPageLatestRequestGuard(this, "registration-sources");
		const token = guard.begin();
		const patientId = this.data.patientId;
		const session = getSessionGeneration();
		const current = () =>
			guard.isCurrent(token) &&
			this.data.patientId === patientId &&
			isCurrentSelectedPatient(patientId) &&
			isCurrentSessionGeneration(session);
		const context = this.data.sourceSchedule ?? this.data;
		const original = {
			serialNumber: this.data.serialNumber,
			timeLabel: this.data.timeLabel,
			timeGroup: this.data.sourceTimeGroup,
		};
		this.setData({
			refreshingSources: true,
			sourceSelectionRequired: true,
			sourceChoices: [],
			error: "",
			sourceNotice: "正在核验最新号源…",
		});
		try {
			if (!context.departmentId || !context.doctorId) {
				this.setData({
					sourceNotice: "当前排班信息已过期，请重新选择医生排班后预约",
				});
				return;
			}
			const schedules = await loadAppointmentSchedulesForDate(
				context.departmentId,
				context.workDate,
				context.doctorId,
			);
			if (!current()) return;
			const schedule = selectRebookingSchedule(schedules, context);
			if (!schedule) {
				this.setData({
					sourceNotice: "原医生当日该班次暂无可用号源，可在此刷新重试",
				});
				return;
			}
			const payload = await requestAppointmentScheduleSources(
				schedule.scheduleId,
			);
			if (!current()) return;
			const sources = requireAppointmentScheduleSourceListData(payload.data);
			if (
				sources.schedule.scheduleId !== schedule.scheduleId ||
				!sameRebookingSchedule(sources.schedule, context)
			)
				throw new ApiError("排班响应不一致", {
					code: "provider-response-invalid",
				});
			if (
				sources.schedule.availabilityStatus !== "open" ||
				sources.schedule.availableSlots <= 0 ||
				sources.items.length === 0
			) {
				this.setData({
					sourceNotice: "原医生当日该班次暂无可用号源，可在此刷新重试",
				});
				return;
			}
			const originalSource = unchangedRebookingSource(sources.items, original);
			this.setData({
				scheduleId: schedule.scheduleId,
				sourceSchedule: sources.schedule,
				sourceChoices: sources.items,
				sourceSelectionRequired: !originalSource,
				sourceNotice: originalSource
					? "号源已更新，请确认预约信息后继续"
					: "原号源已变化，请在下方选择最新时段后继续预约",
				...(originalSource
					? { sourceTimeGroup: originalSource.timeGroup }
					: {}),
			});
			if (autoContinue && originalSource && current()) {
				this.setData({ refreshingSources: false });
				this.submitRegistration(false);
			}
		} catch (error: unknown) {
			if (!current()) return;
			this.setData({
				sourceNotice: "号源暂时无法获取，请在此刷新重试",
				error: errorMessageWithCode(
					error,
					contextualApiErrorMessage(error, "号源暂时无法获取，请稍后重试"),
				),
			});
		} finally {
			if (current()) this.setData({ refreshingSources: false });
		}
	},

	onRefreshSources(): void {
		if (
			this.data.submitting ||
			this.data.refreshingSources ||
			this.data.holdId ||
			this.data.holdIdempotencyKey ||
			this.data.registrationIdempotencyKey
		)
			return;
		void this.refreshSources();
	},

	onSourceChoiceTap(event): void {
		if (
			this.data.submitting ||
			this.data.refreshingSources ||
			this.data.holdId ||
			this.data.holdIdempotencyKey ||
			this.data.registrationIdempotencyKey
		)
			return;
		const index = event.currentTarget?.dataset?.index;
		if (typeof index !== "number" && typeof index !== "string") return;
		const source = this.data.sourceChoices[Number(index)];
		if (!source || !this.data.sourceSchedule) return;
		this.setData({
			serialNumber: source.serialNumber,
			timeLabel: source.timeLabel,
			sourceTimeGroup: source.timeGroup,
			sourceSelectionRequired: false,
			sourceNotice: "已更新预约时段，请确认上方就诊信息后点击确定预约",
			holdIdempotencyKey: "",
			registrationIdempotencyKey: "",
			error: "",
		});
	},

	onUnload(): void {
		disposePageSessionResetListener(this);
		disposePageInstance(this);
	},
});

function isSourceChangedError(error: unknown): boolean {
	return (
		error instanceof ApiError &&
		(error.code === "appointment-source-unavailable" ||
			error.code === "appointment-schedule-reference-expired")
	);
}

function boundedRouteId(value: string | undefined): string {
	const decoded = decodeRouteValue(value);
	return decoded &&
		decoded === decoded.trim() &&
		decoded.length <= 128 &&
		!Array.from(decoded).some(
			(character) =>
				character.charCodeAt(0) <= 0x1f || character.charCodeAt(0) === 0x7f,
		)
		? decoded
		: "";
}

function matchesRouteSchedule(
	schedule: NonNullable<ConfirmRegistrationPageData["sourceSchedule"]>,
	route: ConfirmRegistrationPageData,
): boolean {
	return (
		(!route.departmentId || schedule.departmentId === route.departmentId) &&
		(!route.doctorId || schedule.doctorId === route.doctorId) &&
		schedule.workDate === route.workDate &&
		schedule.shiftName === route.shiftName &&
		(schedule.registrationClassName ?? "") === route.registrationClassName &&
		(schedule.hospitalAreaName ?? "") === route.hospitalAreaName
	);
}

/** 与门诊医生页同规则的路由解码：最多解三层百分号编码，畸形编码按空处理。 */
function decodeRouteValue(value: string | undefined): string | undefined {
	if (typeof value !== "string") return undefined;
	let decoded = value;
	for (let depth = 0; depth < 3; depth += 1) {
		if (!/%[0-9A-Fa-f]{2}/u.test(decoded)) break;
		try {
			const next = decodeURIComponent(decoded);
			if (next === decoded) break;
			decoded = next;
		} catch {
			return undefined;
		}
	}
	return decoded;
}
