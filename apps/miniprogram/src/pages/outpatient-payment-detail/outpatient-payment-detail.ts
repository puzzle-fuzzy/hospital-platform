import { ApiError, getCurrentUser } from "../../services/api-client";
import {
	formatOutpatientAmountLabel,
	formatOutpatientBillDateLabel,
	loadCurrentPatientForOwner,
	loadOutpatientPaymentDetail,
} from "../../services/dashboard-service";
import { errorMessageWithCode } from "../../services/error-presentation";
import { startOutpatientSelfPay } from "../../services/outpatient-self-pay";
import {
	disposePageInstance,
	getPageLatestRequestGuard,
} from "../../services/page-instance-state";
import { switchToPrimaryTab } from "../../services/patient-navigation";
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
import type { OutpatientPaymentDetailPageData } from "../../types";

const HOSPITAL_NAME = "高平市人民医院";

type PaymentStatus = "unpaid" | "paid";

/**
 * 门诊费用页沿用挂号页的支付交互：微信自费走服务端门诊下单链路；医保
 * 入口继续保持受控提示，直到门诊医保授权、6201/6202 和回写 contract 完成。
 */
type OutpatientPaymentDetailPageState = OutpatientPaymentDetailPageData & {
	paymentBusy: boolean;
	paymentMessage: string;
};

type OutpatientPaymentDetailPageMethods = {
	loadDetail(
		patientId: string,
		recordId: string,
		status: PaymentStatus,
	): Promise<void>;
	onRetry(): void;
	onBack(): void;
	onBackHome(): void;
	onMedicalPay(): void;
	onWechatPay(): Promise<void>;
	onUnload(): void;
	formatAmount(amountFen: number): string;
	formatDate(value: string): string;
	statusLabel(status: PaymentStatus): string;
	showError(error: unknown): void;
	showPaymentUnavailable(mode: "医保支付" | "微信支付"): void;
};

function isPaymentStatus(value: unknown): value is PaymentStatus {
	return value === "unpaid" || value === "paid";
}

function validReference(value: unknown): value is string {
	return (
		typeof value === "string" &&
		value.length > 0 &&
		value.length <= 128 &&
		value === value.trim() &&
		!Array.from(value).some((character) => character.charCodeAt(0) <= 0x1f)
	);
}

Page<OutpatientPaymentDetailPageState, OutpatientPaymentDetailPageMethods>({
	data: {
		loading: true,
		error: "",
		hospitalName: HOSPITAL_NAME,
		selectedPatient: null,
		item: null,
		sourcePatientId: "",
		sourceRecordId: "",
		sourceStatus: "",
		paymentBusy: false,
		paymentMessage: "",
	},

	onLoad(options: Record<string, string | undefined>): void {
		registerPageSessionResetListener(this, () => {
			// 会话变化时同时清理患者和费用摘要，禁止旧账号继续看到详情或重试。
			this.setData({
				loading: false,
				error: "登录状态已更新，请返回后重新选择就诊人",
				selectedPatient: null,
				item: null,
				sourcePatientId: "",
				sourceRecordId: "",
				sourceStatus: "",
				paymentBusy: false,
				paymentMessage: "",
			});
		});

		const patientId = options?.patientId;
		const recordId = options?.recordId;
		const status = options?.status;
		if (
			!validReference(patientId) ||
			!validReference(recordId) ||
			!isPaymentStatus(status)
		) {
			this.showError(
				new ApiError("门诊缴费详情引用无效", {
					code: "outpatient-payment-query-invalid",
				}),
			);
			return;
		}
		if (!isCurrentSelectedPatient(patientId)) {
			this.showError(
				new ApiError("当前就诊人已变更，请返回重新选择", {
					code: "patient-selection-required",
				}),
			);
			return;
		}
		this.setData({
			sourcePatientId: patientId,
			sourceRecordId: recordId,
			sourceStatus: status,
		});
		void this.loadDetail(patientId, recordId, status);
	},

	/** 重新确认 owner、患者和会话代际后，才读取单笔费用摘要。 */
	loadDetail(
		patientId: string,
		recordId: string,
		status: PaymentStatus,
	): Promise<void> {
		const guard = getPageLatestRequestGuard(this, "outpatient-payment-detail");
		const token = guard.begin();
		this.setData({
			loading: true,
			error: "",
			item: null,
			paymentBusy: false,
			paymentMessage: "",
		});
		let expectedSessionGeneration = -1;
		return getCurrentUser()
			.then((currentUser) => {
				if (!guard.isCurrent(token)) return undefined;
				expectedSessionGeneration = getSessionGeneration();
				return loadCurrentPatientForOwner(currentUser.data.user.id);
			})
			.then((patientContext) => {
				if (!patientContext || !guard.isCurrent(token)) return undefined;
				expectedSessionGeneration = patientContext.sessionGeneration;
				assertSessionGeneration(
					expectedSessionGeneration,
					"Outpatient payment detail session changed before patient context was confirmed",
				);
				if (
					patientContext.patient.id !== patientId ||
					!isCurrentSelectedPatient(patientId)
				) {
					throw new ApiError("当前就诊人已变更，请返回重新选择", {
						code: "patient-selection-required",
					});
				}
				this.setData({ selectedPatient: patientContext.patient });
				return loadOutpatientPaymentDetail(
					patientId,
					recordId,
					status,
					expectedSessionGeneration,
				);
			})
			.then((detail) => {
				if (!detail || !guard.isCurrent(token)) return;
				assertSessionGeneration(
					expectedSessionGeneration,
					"Outpatient payment detail session changed before detail was committed",
				);
				if (!isCurrentSelectedPatient(patientId)) {
					throw new ApiError("当前就诊人已变更，请返回重新选择", {
						code: "patient-selection-required",
					});
				}
				this.setData({
					selectedPatient: this.data.selectedPatient,
					item: detail.item,
					error: "",
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
		const { sourcePatientId, sourceRecordId, sourceStatus } = this.data;
		if (!sourcePatientId || !sourceRecordId || !isPaymentStatus(sourceStatus))
			return;
		if (!isCurrentSelectedPatient(sourcePatientId)) {
			this.showError(
				new ApiError("当前就诊人已变更，请返回重新选择", {
					code: "patient-selection-required",
				}),
			);
			return;
		}
		void this.loadDetail(sourcePatientId, sourceRecordId, sourceStatus);
	},

	onBack(): void {
		wx.navigateBack({ delta: 1 });
	},

	onBackHome(): void {
		switchToPrimaryTab("/pages/index/index");
	},

	onMedicalPay(): void {
		this.showPaymentUnavailable("医保支付");
	},

	onWechatPay(): Promise<void> {
		if (this.data.paymentBusy || this.data.item?.status !== "unpaid") {
			return Promise.resolve();
		}
		const patientId = this.data.sourcePatientId;
		const recordId = this.data.sourceRecordId;
		if (!patientId || !recordId) return Promise.resolve();
		this.setData({ paymentBusy: true, paymentMessage: "正在准备门诊微信支付" });
		return (async () => {
			try {
				const result = await startOutpatientSelfPay(
					recordId,
					patientId,
					(_stage, message) => this.setData({ paymentMessage: message }),
				);
				if (result.data.status === "cash_paid") {
					this.setData({ paymentMessage: "门诊支付已确认" });
					wx.showModal({
						title: "支付成功",
						content: "本笔门诊费用已完成支付。",
						showCancel: false,
						confirmText: "知道了",
						success: () => this.onBack(),
					});
				}
			} catch (error) {
				this.setData({
					paymentMessage: errorMessageWithCode(
						error,
						"门诊微信支付未完成，请稍后重试",
					),
				});
			} finally {
				this.setData({ paymentBusy: false });
			}
		})();
	},

	onUnload(): void {
		disposePageSessionResetListener(this);
		disposePageInstance(this);
	},

	formatAmount(amountFen: number): string {
		return formatOutpatientAmountLabel(amountFen);
	},

	formatDate(value: string): string {
		return formatOutpatientBillDateLabel(value);
	},

	statusLabel(status: PaymentStatus): string {
		return status === "paid" ? "已缴费" : "待缴费";
	},

	showError(error: unknown): void {
		const message = patientContextErrorMessage(error, "门诊费用详情加载失败");
		this.setData({
			loading: false,
			error: errorMessageWithCode(error, message),
			item: null,
			paymentBusy: false,
			paymentMessage: "",
		});
	},

	/** 门诊医保入口仍未接入，不能把费用 recordId 冒充预约号调用挂号医保接口。 */
	showPaymentUnavailable(mode: "医保支付" | "微信支付"): void {
		if (this.data.paymentBusy) return;
		this.setData({
			paymentBusy: true,
			paymentMessage: `${mode}入口已准备，正在确认门诊支付服务状态`,
		});
		wx.showModal({
			title: `${mode}暂未开放`,
			content:
				"门诊微信自费支付已接入；门诊医保授权和结算仍在接入中，请先使用微信支付或联系医院。",
			showCancel: false,
			confirmText: "知道了",
			complete: () =>
				this.setData({
					paymentBusy: false,
					paymentMessage: "",
				}),
		});
	},
});
