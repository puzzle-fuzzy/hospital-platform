import { ApiError } from "../../services/api-client";
import { errorMessageWithCode } from "../../services/error-presentation";
import {
	continueMedicalCashPayment,
	type MedicalPaymentAmounts,
	type PendingPayment,
	readLastMedicalPaymentResult,
	readPendingPayment,
} from "../../services/medical-insurance";
import { switchToPrimaryTab } from "../../services/patient-navigation";
import {
	disposePageSessionResetListener,
	registerPageSessionResetListener,
} from "../../services/session-events";

type SettlementPending = PendingPayment & {
	businessType: "outpatient";
	recordId: string;
	orderId: string;
	amounts: MedicalPaymentAmounts;
	phase: "medical_cash_required" | "cash_payment";
};

type OutpatientMedicalSettlementPageData = {
	loading: boolean;
	hasPending: boolean;
	error: string;
	totalAmountLabel: string;
	insuranceAmountLabel: string;
	cashAmountLabel: string;
	paymentBusy: boolean;
	paymentMessage: string;
};

type OutpatientMedicalSettlementPageMethods = {
	onLoad(): void;
	onShow(): void;
	onPay(): void;
	payment(): Promise<void>;
	onBack(): void;
	onBackHome(): void;
	onUnload(): void;
	renderPending(): void;
};

function isPositiveInteger(value: unknown): value is number {
	return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}

function isNonNegativeInteger(value: unknown): value is number {
	return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function isSettlementPending(
	value: ReturnType<typeof readPendingPayment>,
): value is SettlementPending {
	if (!value || value.businessType !== "outpatient") return false;
	if (
		!value.recordId ||
		!value.orderId ||
		(value.phase !== "medical_cash_required" && value.phase !== "cash_payment")
	)
		return false;
	const amounts = value.amounts;
	return Boolean(
		amounts &&
			isPositiveInteger(amounts.totalFen) &&
			isNonNegativeInteger(amounts.insuranceFen) &&
			isNonNegativeInteger(amounts.cashFen),
	);
}

function formatFen(value: number): string {
	return `${(value / 100).toFixed(2)} 元`;
}

function paymentResultUrl(
	patientId: string,
	recordId: string,
	orderId: string,
): string {
	return `/pages/payment-result/payment-result?business=outpatient&channel=medical&patientId=${encodeURIComponent(patientId)}&recordId=${encodeURIComponent(recordId)}&orderId=${encodeURIComponent(orderId)}`;
}

function emptyData(): OutpatientMedicalSettlementPageData {
	return {
		loading: true,
		hasPending: false,
		error: "",
		totalAmountLabel: "",
		insuranceAmountLabel: "",
		cashAmountLabel: "",
		paymentBusy: false,
		paymentMessage: "",
	};
}

Page<
	OutpatientMedicalSettlementPageData,
	OutpatientMedicalSettlementPageMethods
>({
	data: emptyData(),

	onLoad(): void {
		registerPageSessionResetListener(this, () => {
			this.setData({
				loading: false,
				hasPending: false,
				error: "登录状态已更新，请返回后重新选择就诊人",
				paymentBusy: false,
				paymentMessage: "",
			});
		});
		this.renderPending();
	},

	onShow(): void {
		// 微信支付返回时，onPay 仍在等待官方支付 API 的结果；不能用旧的
		// 本地快照覆盖进度文案。用户返回列表再重新进入时才重新读取上下文。
		if (!this.data.paymentBusy) this.renderPending();
	},

	renderPending(): void {
		const pending = readPendingPayment();
		if (!isSettlementPending(pending)) {
			this.setData({
				loading: false,
				hasPending: false,
				error: "医保结算信息已失效，请返回门诊缴费列表重新发起",
				paymentMessage: "",
			});
			return;
		}
		this.setData({
			loading: false,
			hasPending: true,
			error: "",
			totalAmountLabel: formatFen(pending.amounts.totalFen),
			insuranceAmountLabel: formatFen(pending.amounts.insuranceFen),
			cashAmountLabel: formatFen(pending.amounts.cashFen),
			paymentMessage:
				pending.phase === "cash_payment"
					? "上次支付尚未确认，请点击去支付继续；如已扣款请勿重复操作"
					: "以上金额来自医保 6202 结算结果，请确认后再去支付",
		});
	},

	onPay(): void {
		void this.payment();
	},

	async payment(): Promise<void> {
		if (this.data.paymentBusy) return;
		const pending = readPendingPayment();
		if (!isSettlementPending(pending)) {
			this.setData({
				hasPending: false,
				error: "医保结算信息已失效，请返回门诊缴费列表重新发起",
			});
			return;
		}
		this.setData({
			paymentBusy: true,
			error: "",
			paymentMessage: "正在准备微信医保支付，请勿重复点击",
		});
		try {
			await continueMedicalCashPayment(pending, (_stage, message) =>
				this.setData({ paymentMessage: message }),
			);
			const completed = readLastMedicalPaymentResult();
			if (!completed || completed.recordId !== pending.recordId) {
				throw new ApiError("医保支付结果不可用", {
					code: "provider-response-invalid",
				});
			}
			wx.redirectTo({
				url: paymentResultUrl(
					pending.patientId,
					pending.recordId,
					completed.orderId,
				),
			});
		} catch (error) {
			this.setData({
				error: "",
				paymentMessage: errorMessageWithCode(
					error,
					"医保支付未完成，请稍后点击去支付继续",
				),
			});
		} finally {
			this.setData({ paymentBusy: false });
		}
	},

	onBack(): void {
		wx.navigateBack({ delta: 1 });
	},

	onBackHome(): void {
		switchToPrimaryTab("/pages/index/index");
	},

	onUnload(): void {
		disposePageSessionResetListener(this);
	},
});
