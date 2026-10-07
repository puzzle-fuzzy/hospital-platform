import { ApiError, getCurrentUser } from "../../services/api-client";
import {
	formatOutpatientAmountLabel,
	formatOutpatientBillDateLabel,
	loadCurrentPatientForOwner,
	loadOutpatientPaymentDetail,
} from "../../services/dashboard-service";
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
const PAID_DETAIL_RETRY_DELAYS_MS = [800, 1_200, 2_000] as const;

function waitForPaidDetailSync(delayMs: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, delayMs));
}

/**
 * 支付成功后的医院费用读模型可能需要极短时间同步。这里只对已支付详情的
 * 明确「记录未找到」状态重试，不能把患者、会话或 Provider 失败误报为同步中。
 */
function isPaidDetailSyncPending(error: unknown): boolean {
	return (
		error instanceof ApiError &&
		error.code === "outpatient-payment-record-not-found"
	);
}

type PaymentStatus = "unpaid" | "paid";
type PaymentBusyKind = "medical" | "wechat" | "";

/**
 * 门诊费用页沿用挂号页的支付交互：两种按钮都进入服务端统一支付编排；
 * 医保入口只把 recordId/patientId 作为业务上下文，6201 的 outTradeOrderIds
 * 由服务端重新调用 2.6.33 解析。
 */
type OutpatientPaymentDetailPageState = OutpatientPaymentDetailPageData & {
	paymentBusy: PaymentBusyKind;
	paymentMessage: string;
	paidDetailConfirming: boolean;
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
	onUnload(): void;
	formatAmount(amountFen: number): string;
	formatDate(value: string): string;
	statusLabel(status: PaymentStatus, paymentStatus?: "refunding"): string;
	showError(error: unknown): void;
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
		paymentBusy: "",
		paymentMessage: "",
		paidDetailConfirming: false,
	},

	onLoad(options: Record<string, string | undefined>): void {
		registerPageSessionResetListener(this, () => {
			// 会话变化时同时清理患者和费用记录，禁止旧账号继续看到详情或重试。
			this.setData({
				loading: false,
				error: "登录状态已更新，请返回后重新选择就诊人",
				selectedPatient: null,
				item: null,
				sourcePatientId: "",
				sourceRecordId: "",
				sourceStatus: "",
				paymentBusy: "",
				paymentMessage: "",
				paidDetailConfirming: false,
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

	/** 重新确认 owner、患者和会话代际后，才读取单笔费用记录。 */
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
			paymentBusy: "",
			paymentMessage: "",
			paidDetailConfirming: false,
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
				return (async () => {
					let lastSyncError: unknown;
					for (const delayMs of [0, ...PAID_DETAIL_RETRY_DELAYS_MS]) {
						if (delayMs > 0) {
							if (!guard.isCurrent(token)) return undefined;
							this.setData({
								paidDetailConfirming: true,
								paymentMessage: "支付已完成，正在确认费用明细，请稍候",
							});
							await waitForPaidDetailSync(delayMs);
						}
						if (!guard.isCurrent(token)) return undefined;
						try {
							return await loadOutpatientPaymentDetail(
								patientId,
								recordId,
								status,
								expectedSessionGeneration,
							);
						} catch (error) {
							if (status !== "paid" || !isPaidDetailSyncPending(error)) {
								throw error;
							}
							lastSyncError = error;
						}
					}
					throw lastSyncError;
				})();
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
					paymentMessage: "",
					paidDetailConfirming: false,
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

	statusLabel(status: PaymentStatus, paymentStatus?: "refunding"): string {
		if (paymentStatus === "refunding") return "退款中";
		return status === "paid" ? "已缴费" : "待缴费";
	},

	showError(error: unknown): void {
		const message = patientContextErrorMessage(
			error,
			"暂时无法加载门诊费用详情，请稍后重试",
		);
		this.setData({
			loading: false,
			error: message,
			item: null,
			paymentBusy: "",
			paymentMessage: "",
			paidDetailConfirming: false,
		});
	},
});
