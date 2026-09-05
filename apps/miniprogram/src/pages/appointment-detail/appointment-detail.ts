import {
	ApiError,
	getCurrentUser,
	requestAppointmentCancellation,
	requestAppointmentDetail,
} from "../../services/api-client";
import { errorMessageWithCode } from "../../services/error-presentation";
import { loadCurrentPatientForOwner } from "../../services/dashboard-service";
import {
	disposePageInstance,
	getPageLatestRequestGuard,
} from "../../services/page-instance-state";
import {
	isCurrentSelectedPatient,
	patientContextErrorMessage,
} from "../../services/patient-selection-service";
import { assertSessionGeneration } from "../../services/session-boundary";
import {
	disposePageSessionResetListener,
	registerPageSessionResetListener,
} from "../../services/session-events";
import { getSessionGeneration } from "../../services/session-generation";
import type { AppointmentDetailPageData } from "../../types";

const STATUS_LABELS: Record<AppointmentDetailPageData["status"], string> = {
	"": "",
	scheduled: "已预约",
	cancelled: "已取消",
	completed: "已完成",
	missed: "已爽约",
	stopped: "停诊",
	substituted: "替诊",
	registered: "已登记",
	unknown: "状态未知",
};

type AppointmentDetailPageMethods = {
	loadDetail(patientId: string, appointmentId: string): Promise<void>;
	loadPatientContext(patientId: string): Promise<void>;
	onRetry(): void;
	onCancel(): void;
	onBack(): void;
	onUnload(): void;
	showError(error: unknown): void;
};

type AppointmentDetailRouteOptions = {
	patientId?: string;
	appointmentId?: string;
	departmentName?: string;
	doctorName?: string;
	workDate?: string;
	workTime?: string;
	location?: string;
	serialNumber?: string;
	status?: string;
};

type AppointmentDetailPageState = AppointmentDetailPageData & {
	location: string;
};

function decode(value: string | undefined): string {
	if (!value) return "";
	try {
		return decodeURIComponent(value);
	} catch {
		return value;
	}
}

function safeRouteText(value: string | undefined, maxLength: number): string {
	const decoded = decode(value);
	if (
		!decoded ||
		decoded.length > maxLength ||
		decoded !== decoded.trim() ||
		Array.from(decoded).some((character) => {
			const code = character.charCodeAt(0);
			return code <= 0x1f || code === 0x7f;
		})
	) {
		return "";
	}
	return decoded;
}

function validStatus(
	value: string,
): value is Exclude<AppointmentDetailPageData["status"], ""> {
	return Object.hasOwn(STATUS_LABELS, value) && value !== "";
}

function periodOf(shiftName: string, workTime: string): string {
	if (shiftName === "上午" || shiftName === "下午" || shiftName === "晚上") {
		return shiftName;
	}
	const hour = Number(workTime.slice(0, 2));
	if (!Number.isInteger(hour)) return shiftName;
	return hour < 12 ? "上午" : hour < 18 ? "下午" : "晚上";
}

function moneyLabel(totalFen: number): string {
	return `${(totalFen / 100).toFixed(2)} 元`;
}

function detailDefaults(): AppointmentDetailPageState {
	return {
		loading: true,
		error: "",
		appointmentId: "",
		patientId: "",
		patientName: "",
		patientCardLabel: "",
		hospitalName: "高平市人民医院",
		departmentName: "",
		doctorName: "",
		workDate: "",
		shiftName: "",
		workTime: "",
		periodLabel: "",
		sourceSerialNumber: "",
		totalFen: 0,
		totalLabel: "暂无金额信息",
		status: "",
		statusLabel: "",
		canCancel: false,
		canceling: false,
		localDetail: false,
		sourceAppointmentId: "",
		sourcePatientId: "",
		legacySummary: false,
		location: "",
	};
}

Page<AppointmentDetailPageState, AppointmentDetailPageMethods>({
	data: detailDefaults(),

	onLoad(options: AppointmentDetailRouteOptions): void {
		registerPageSessionResetListener(this, () => {
			// 详情页的 appointmentId 和 patientId 都属于上一会话；会话切换后
			// 清空详情，不能让页面栈继续展示上一账号的预约和患者姓名。
			this.setData({
				loading: false,
				error: "登录状态已更新，请返回后重新选择就诊人",
				appointmentId: "",
				patientId: "",
				patientName: "",
				patientCardLabel: "",
				departmentName: "",
				doctorName: "",
				workDate: "",
				shiftName: "",
				workTime: "",
				periodLabel: "",
				sourceSerialNumber: "",
				totalFen: 0,
				totalLabel: "",
				status: "",
				statusLabel: "",
				canCancel: false,
				localDetail: false,
				legacySummary: false,
				location: "",
			});
		});

		const patientId = safeRouteText(options?.patientId, 128);
		const appointmentId = safeRouteText(options?.appointmentId, 64);
		if (!patientId) {
			this.showError(
				new ApiError("当前就诊人引用无效", {
					code: "patient-selection-required",
				}),
			);
			return;
		}
		this.setData({
			sourcePatientId: patientId,
			sourceAppointmentId: appointmentId,
			patientId,
		});

		if (appointmentId) {
			void this.loadDetail(patientId, appointmentId);
			return;
		}

		// Provider 历史记录没有平台 appointmentId。这里仅接收上一页已经
		// 通过列表 contract 校验的摘要，允许用户查看详情版式，但不显示取消
		// 或支付动作，也不把摘要当作可写入的预约引用。
		const departmentName = safeRouteText(options?.departmentName, 128);
		const doctorName = safeRouteText(options?.doctorName, 128);
		const workDate = safeRouteText(options?.workDate, 16);
		const status = safeRouteText(options?.status, 32);
		if (
			!departmentName ||
			!doctorName ||
			!/^(\d{4})-(\d{2})-(\d{2})$/.test(workDate) ||
			!validStatus(status)
		) {
			this.showError(
				new ApiError("挂号详情引用无效", {
					code: "appointment-query-invalid",
				}),
			);
			return;
		}
		const workTime = safeRouteText(options.workTime, 11);
		this.setData({
			loading: false,
			legacySummary: true,
			localDetail: false,
			departmentName,
			doctorName,
			workDate,
			workTime,
			shiftName: "",
			periodLabel: periodOf("", workTime),
			sourceSerialNumber: safeRouteText(options.serialNumber, 32),
			status: status as AppointmentDetailPageData["status"],
			statusLabel: STATUS_LABELS[status as AppointmentDetailPageData["status"]],
			location: safeRouteText(options.location, 256),
			totalFen: 0,
			totalLabel: "以医院实际收费记录为准",
			canCancel: false,
		});
		void this.loadPatientContext(patientId);
	},

	onShow(): void {
		if (
			this.data.legacySummary &&
			!this.data.loading &&
			this.data.sourcePatientId
		) {
			void this.loadPatientContext(this.data.sourcePatientId);
		}
	},

	loadPatientContext(patientId: string): Promise<void> {
		return getCurrentUser()
			.then((currentUser) =>
				loadCurrentPatientForOwner(currentUser.data.user.id),
			)
			.then((context) => {
				if (
					context.patient.id !== patientId ||
					!isCurrentSelectedPatient(patientId)
				) {
					throw new ApiError("当前就诊人已变更，请重新选择后查看详情", {
						code: "patient-selection-required",
					});
				}
				this.setData({
					patientName: context.patient.displayName,
					patientCardLabel:
						context.patient.cardNumberMasked === "未绑定"
							? "就诊卡未绑定"
							: `就诊卡：${context.patient.cardNumberMasked}`,
				});
			})
			.catch((error) => {
				if (this.data.legacySummary) this.showError(error);
			});
	},

	/** 先复核当前 owner/患者，再用固定会话代际请求服务端真实详情。 */
	loadDetail(patientId: string, appointmentId: string): Promise<void> {
		const guard = getPageLatestRequestGuard(this, "appointment-detail");
		const token = guard.begin();
		this.setData({ loading: true, error: "" });
		let expectedSessionGeneration = -1;
		return getCurrentUser()
			.then((currentUser) => {
				if (!guard.isCurrent(token)) return undefined;
				expectedSessionGeneration = getSessionGeneration();
				return loadCurrentPatientForOwner(currentUser.data.user.id);
			})
			.then((context) => {
				if (!context || !guard.isCurrent(token)) return undefined;
				expectedSessionGeneration = context.sessionGeneration;
				assertSessionGeneration(
					expectedSessionGeneration,
					"Appointment detail session changed before patient context was confirmed",
				);
				if (
					context.patient.id !== patientId ||
					!isCurrentSelectedPatient(patientId)
				) {
					throw new ApiError("当前就诊人已变更，请重新选择后查看详情", {
						code: "patient-selection-required",
					});
				}
				return requestAppointmentDetail(
					appointmentId,
					patientId,
					expectedSessionGeneration,
				);
			})
			.then((payload) => {
				if (!payload || !guard.isCurrent(token)) return;
				assertSessionGeneration(
					expectedSessionGeneration,
					"Appointment detail session changed before detail was committed",
				);
				if (!isCurrentSelectedPatient(patientId)) {
					this.showError(
						new ApiError("当前就诊人已变更，请重新选择后查看详情", {
							code: "patient-selection-required",
						}),
					);
					return;
				}
				const detail = payload.data;
				this.setData({
					loading: false,
					error: "",
					appointmentId: detail.appointmentId,
					patientId: detail.patientId,
					patientName: detail.patient.displayName,
					patientCardLabel:
						detail.patient.cardNumberMasked === "未绑定"
							? "就诊卡未绑定"
							: `就诊卡：${detail.patient.cardNumberMasked}`,
					hospitalName: detail.hospitalName,
					departmentName: detail.departmentName,
					doctorName: detail.doctorName,
					workDate: detail.workDate,
					shiftName: detail.shiftName,
					workTime: detail.workTime ?? "",
					periodLabel: periodOf(detail.shiftName, detail.workTime ?? ""),
					sourceSerialNumber: detail.sourceSerialNumber,
					totalFen: detail.totalFen,
					totalLabel: moneyLabel(detail.totalFen),
					status: detail.status,
					statusLabel: STATUS_LABELS[detail.status],
					canCancel: detail.status === "scheduled",
					localDetail: true,
					legacySummary: false,
				});
			})
			.catch((error) => {
				if (guard.isCurrent(token)) this.showError(error);
			})
			.finally(() => {
				if (guard.isCurrent(token)) this.setData({ loading: false });
			});
	},

	onRetry(): void {
		if (this.data.loading) return;
		if (this.data.sourceAppointmentId && this.data.sourcePatientId) {
			void this.loadDetail(
				this.data.sourcePatientId,
				this.data.sourceAppointmentId,
			);
		}
	},

	onCancel(): void {
		if (!this.data.localDetail || !this.data.canCancel || this.data.canceling) {
			return;
		}
		wx.showModal({
			title: "取消预约",
			content: "确认取消这条预约吗？取消后不能直接恢复。",
			confirmText: "确认取消",
			cancelText: "暂不取消",
			success: (result) => {
				if (!result.confirm || this.data.canceling) return;
				this.setData({ canceling: true });
				requestAppointmentCancellation(this.data.appointmentId)
					.then(() => {
						this.setData({
							status: "cancelled",
							statusLabel: STATUS_LABELS.cancelled,
							canCancel: false,
						});
						wx.showToast({ title: "取消预约成功", icon: "success" });
					})
					.catch((error) => this.showError(error))
					.finally(() => this.setData({ canceling: false }));
			},
		});
	},

	onBack(): void {
		wx.navigateBack({
			fail: () => wx.switchTab({ url: "/pages/index/index" }),
		});
	},

	onUnload(): void {
		disposePageSessionResetListener(this);
		disposePageInstance(this);
	},

	showError(error: unknown): void {
		const message = patientContextErrorMessage(error, "挂号详情暂时无法获取");
		this.setData({
			loading: false,
			error: errorMessageWithCode(error, message),
			appointmentId: "",
			patientName: "",
			patientCardLabel: "",
			canCancel: false,
		});
		wx.showToast({ title: message, icon: "none" });
	},
});
