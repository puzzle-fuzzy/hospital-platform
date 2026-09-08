import {
	contextualApiErrorMessage,
	createIdempotencyKey,
	requestAppointmentCancellation,
	requestAppointmentHold,
	requestAppointmentRegistration,
} from "../../services/api-client";
import { loadCurrentPatient } from "../../services/dashboard-service";
import { errorMessageWithCode } from "../../services/error-presentation";
import { logClientErrorTransformed } from "../../services/telemetry";
import type { ConfirmRegistrationPageData } from "../../types";

type ConfirmRegistrationPageMethods = {
	loadPatient(): void;
	onOpenPatientSelector(): void;
	onToggleAgree(): void;
	onOpenNotice(): void;
	onConfirmTap(): void;
	submitRegistration(): void;
	onCancelAndRetry(): void;
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
		departmentName: "",
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
			departmentName: decodeRouteValue(options.departmentName) ?? "",
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
		this.loadPatient();
	},

	onShow() {
		// 从统一就诊人选择页返回后重新确认，不沿用上一位就诊人卡片。
		if (!this.data.patientLoading) this.loadPatient();
	},

	loadPatient(): void {
		this.setData({ patientLoading: true });
		loadCurrentPatient()
			.then((patient) => {
				const patientChanged =
					Boolean(this.data.patientId) && this.data.patientId !== patient.id;
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
							}
						: {}),
				});
			})
			.catch((error: unknown) => {
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
				this.setData({ patientLoading: false });
			});
	},

	onOpenPatientSelector(): void {
		if (this.data.submitting) return;
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
	 * 纯医保/混合支付、普通自费支付和最终回写都由该页继续处理。
	 */
	onConfirmTap(): void {
		if (this.data.submitting) return;
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
	submitRegistration(): void {
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

		void (async () => {
			let holdId = this.data.holdId;
			if (!holdId) {
				const hold = await requestAppointmentHold(
					{
						patientId: this.data.patientId,
						scheduleId: this.data.scheduleId,
						sourceSerialNumber: this.data.serialNumber,
					},
					holdIdempotencyKey,
				);
				holdId = hold.data.holdId;
				this.setData({ holdId });
			}
			const registration = await requestAppointmentRegistration(
				{ patientId: this.data.patientId, holdId },
				registrationIdempotencyKey,
			);
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
		if (!duplicate || this.data.submitting) return;
		wx.showModal({
			title: "确认取消并重新预约？",
			content:
				"将先取消当前已有预约。取消成功后，系统会重新核验号源、重新预约，再进入支付；取消失败时会保留原预约。",
			confirmText: "确认继续",
			success: (result) => {
				if (!result.confirm) return;
				this.setData({ submitting: true, error: "" });
				void requestAppointmentCancellation(duplicate.appointmentId)
					.then(() => {
						this.setData({
							duplicate: null,
							holdId: "",
							holdIdempotencyKey: "",
							registrationIdempotencyKey: "",
						});
						this.submitRegistration();
					})
					.catch((error: unknown) => {
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
		});
	},
});

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
