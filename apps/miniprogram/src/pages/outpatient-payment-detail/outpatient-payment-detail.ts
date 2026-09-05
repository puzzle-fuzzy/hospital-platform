import { ApiError, getCurrentUser } from "../../services/api-client";
import { errorMessageWithCode } from "../../services/error-presentation";
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

type OutpatientPaymentDetailPageMethods = {
	loadDetail(
		patientId: string,
		recordId: string,
		status: PaymentStatus,
	): Promise<void>;
	onRetry(): void;
	onBack(): void;
	onUnload(): void;
	formatAmount(amountFen: number): string;
	formatDate(value: string): string;
	statusLabel(status: PaymentStatus): string;
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

Page<OutpatientPaymentDetailPageData, OutpatientPaymentDetailPageMethods>({
	data: {
		loading: true,
		error: "",
		hospitalName: HOSPITAL_NAME,
		selectedPatient: null,
		item: null,
		sourcePatientId: "",
		sourceRecordId: "",
		sourceStatus: "",
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
		this.setData({ loading: true, error: "", item: null });
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
		});
	},
});
