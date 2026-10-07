import { ApiError } from "../../services/api-client";
import { errorMessageWithCode } from "../../services/error-presentation";
import {
	continueMedicalPayment,
	createMedicalPaymentContext,
	type MedicalBusinessRecovery,
	type MedicalPaymentAmounts,
	navigateToOutpatientMedicalAuth,
	type PaymentProgress,
	queryMedicalBusinessRecovery,
	resumeMedicalSettlementFromPending,
	resumeOrContinueMedicalCashPaymentFromPending,
} from "../../services/medical-insurance";
import {
	clearMedicalInsuranceAuthHandoff,
	consumeMedicalInsuranceAuthReturn,
	hasMedicalInsuranceAuthReturn,
} from "../../services/medical-insurance-auth-handoff";
import { switchToPrimaryTab } from "../../services/patient-navigation";
import {
	disposePageSessionResetListener,
	registerPageSessionResetListener,
} from "../../services/session-events";

const HOSPITAL_NAME = "高平市人民医院";

type OutpatientMedicalSettlementPageData = {
	loading: boolean;
	hasPending: boolean;
	error: string;
	hospitalName: string;
	totalAmountLabel: string;
	insuranceAmountLabel: string;
	cashAmountLabel: string;
	cashAmountValue: string;
	paymentBusy: boolean;
	paymentMessage: string;
	canRetrySettlement: boolean;
	patientId: string;
	recordId: string;
	hasShown: boolean;
};

type OutpatientMedicalSettlementPageMethods = {
	onLoad(options: Record<string, string | undefined>): void;
	onShow(): void;
	resumeAuthorizedPayment(forceAuthorization?: boolean): Promise<void>;
	onRetrySettlement(): void;
	onPay(): void;
	payment(): Promise<void>;
	onBack(): void;
	onBackHome(): void;
	onLoadingTouchMove(): void;
	onUnload(): void;
	renderRecovery(recovery: MedicalBusinessRecovery): void;
	redirectCompleted(recovery: MedicalBusinessRecovery): void;
};

function decodeRouteValue(value: string | undefined): string {
	if (typeof value !== "string") return "";
	try {
		const decoded = decodeURIComponent(value).trim();
		if (decoded.length < 1 || decoded.length > 128) return "";
		return Array.from(decoded).some(
			(character) => character.charCodeAt(0) <= 0x1f,
		)
			? ""
			: decoded;
	} catch {
		return "";
	}
}

function formatFenValue(value: number): string {
	return (value / 100).toFixed(2);
}

function formatFen(value: number): string {
	return `${formatFenValue(value)}元`;
}

function hasAmounts(
	recovery: MedicalBusinessRecovery,
): recovery is MedicalBusinessRecovery & { amounts: MedicalPaymentAmounts } {
	return Boolean(recovery.amounts);
}

function settlementProgressMessage(
	stage: PaymentProgress,
	message: string,
): string {
	if (stage === "insuring") return `6201：${message}`;
	if (stage === "settling" || stage === "polling") return `6202：${message}`;
	return message;
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
		hospitalName: HOSPITAL_NAME,
		totalAmountLabel: "--",
		insuranceAmountLabel: "--",
		cashAmountLabel: "--",
		cashAmountValue: "--",
		paymentBusy: false,
		paymentMessage: "",
		canRetrySettlement: false,
		patientId: "",
		recordId: "",
		hasShown: false,
	};
}

Page<
	OutpatientMedicalSettlementPageData,
	OutpatientMedicalSettlementPageMethods
>({
	data: emptyData(),

	onLoad(options): void {
		registerPageSessionResetListener(this, () => {
			clearMedicalInsuranceAuthHandoff();
			this.setData({
				loading: false,
				hasPending: false,
				error: "登录状态已更新，请返回后重新选择就诊人",
				paymentBusy: false,
				paymentMessage: "",
				canRetrySettlement: false,
				patientId: "",
				recordId: "",
			});
		});
		const patientId = decodeRouteValue(options.patientId);
		const recordId = decodeRouteValue(options.recordId);
		if (!patientId || !recordId) {
			this.setData({
				loading: false,
				error: "医保结算引用已失效，请返回门诊缴费列表重新进入",
			});
			return;
		}
		this.setData({ patientId, recordId });
		void this.resumeAuthorizedPayment(options.start === "1");
	},

	onShow(): void {
		if (!this.data.hasShown) {
			this.setData({ hasShown: true });
			return;
		}
		if (this.data.paymentBusy || !this.data.patientId || !this.data.recordId)
			return;
		if (
			hasMedicalInsuranceAuthReturn({
				businessType: "outpatient",
				businessId: this.data.recordId,
				patientId: this.data.patientId,
			})
		) {
			void this.resumeAuthorizedPayment();
		}
	},

	async resumeAuthorizedPayment(forceAuthorization = false): Promise<void> {
		if (this.data.paymentBusy) return;
		const { patientId, recordId } = this.data;
		if (!patientId || !recordId) return;
		const authCode = consumeMedicalInsuranceAuthReturn({
			businessType: "outpatient",
			businessId: recordId,
			patientId,
		});
		this.setData({
			loading: true,
			hasPending: false,
			error: "",
			paymentBusy: true,
			paymentMessage: authCode
				? "正在提交本次医保授权并查询服务端订单"
				: "正在查询服务端医保订单，请稍候",
			canRetrySettlement: false,
		});
		const business = {
			businessType: "outpatient" as const,
			businessId: recordId,
			patientId,
		};
		const progress = (stage: PaymentProgress, message: string) =>
			this.setData({
				paymentMessage: settlementProgressMessage(stage, message),
			});
		try {
			let recovery = await queryMedicalBusinessRecovery(business);
			if (recovery && !recovery.recoveryAllowed) {
				throw new ApiError("医保订单存在冲突，需要医院人工核实", {
					statusCode: 409,
					code: "payment-notification-conflict",
				});
			}
			if (authCode) {
				await continueMedicalPayment(
					authCode,
					createMedicalPaymentContext({
						...business,
						...(recovery ? { order: recovery } : {}),
						phase: "authorization",
					}),
					progress,
				);
			} else if (recovery?.authorizationPending) {
				this.setData({
					loading: false,
					hasPending: false,
					error: "",
					paymentMessage:
						"上一次医保授权正在确认；按钮已恢复，可稍后再次查询，请勿重复展码",
					canRetrySettlement: true,
				});
				return;
			} else if (
				!recovery ||
				(recovery.status === "created" && !recovery.authorizationReady)
			) {
				if (!forceAuthorization) {
					this.setData({
						loading: false,
						hasPending: false,
						error: "尚未完成医保授权，请点击查询原订单后重新授权",
						paymentMessage: "",
						canRetrySettlement: true,
					});
					return;
				}
				this.setData({
					loading: false,
					paymentMessage: "请在医保小程序完成授权，返回后将重新查询服务端",
				});
				await navigateToOutpatientMedicalAuth(recordId, patientId);
				return;
			} else if (recovery.status !== "cash_pending") {
				await resumeMedicalSettlementFromPending(
					createMedicalPaymentContext({
						...business,
						order: recovery,
						phase: "medical_processing",
					}),
					progress,
				);
			}

			recovery = await queryMedicalBusinessRecovery(business);
			if (!recovery) {
				throw new ApiError("尚未查询到医保订单", {
					code: "medical-insurance-order-not-found",
				});
			}
			if (recovery.status === "insurance_settled") {
				this.redirectCompleted(recovery);
				return;
			}
			if (recovery.status === "cash_pending" && hasAmounts(recovery)) {
				this.renderRecovery(recovery);
				return;
			}
			this.setData({
				loading: false,
				hasPending: false,
				error: "医保结算仍在确认，请再次查询原订单",
				paymentMessage: "",
				canRetrySettlement: true,
			});
		} catch (error) {
			this.setData({
				loading: false,
				hasPending: false,
				error: errorMessageWithCode(
					error,
					"门诊医保结算未完成，请再次查询原订单",
				),
				paymentMessage: "",
				canRetrySettlement: true,
			});
		} finally {
			this.setData({ paymentBusy: false });
		}
	},

	onRetrySettlement(): void {
		void this.resumeAuthorizedPayment(true);
	},

	renderRecovery(recovery): void {
		if (!hasAmounts(recovery)) {
			this.setData({
				loading: false,
				hasPending: false,
				error: "医保结算金额尚未形成，请查询原订单",
				canRetrySettlement: true,
			});
			return;
		}
		this.setData({
			loading: false,
			hasPending: true,
			error: "",
			totalAmountLabel: formatFen(recovery.amounts.totalFen),
			insuranceAmountLabel: formatFen(recovery.amounts.insuranceFen),
			cashAmountLabel: formatFen(recovery.amounts.cashFen),
			cashAmountValue: formatFenValue(recovery.amounts.cashFen),
			paymentMessage:
				"点击去支付时会再次查询服务端状态，不使用上一次按钮或本地缓存",
			canRetrySettlement: false,
		});
	},

	redirectCompleted(recovery): void {
		this.setData({
			loading: false,
			hasPending: false,
			error: "",
			paymentMessage: "医保支付已确认，正在打开支付结果",
			canRetrySettlement: false,
		});
		wx.redirectTo({
			url: paymentResultUrl(
				this.data.patientId,
				this.data.recordId,
				recovery.orderId,
			),
			fail: () => {
				// 导航失败不能遗留 loading/disabled。订单已经由服务端确认，
				// 当前页恢复“查询原订单”，再次点击只会查同一服务端订单。
				this.setData({
					loading: false,
					hasPending: false,
					paymentBusy: false,
					error: "医保支付已确认，但结果页打开失败，请再次查询原订单",
					paymentMessage: "",
					canRetrySettlement: true,
				});
			},
		});
	},

	onPay(): void {
		void this.payment();
	},

	async payment(): Promise<void> {
		if (this.data.paymentBusy) return;
		const { patientId, recordId } = this.data;
		if (!patientId || !recordId) return;
		this.setData({
			paymentBusy: true,
			error: "",
			paymentMessage: "正在重新查询服务端医保订单",
		});
		const business = {
			businessType: "outpatient" as const,
			businessId: recordId,
			patientId,
		};
		const progress = (_stage: PaymentProgress, message: string) =>
			this.setData({ paymentMessage: message });
		try {
			let recovery = await queryMedicalBusinessRecovery(business);
			if (!recovery) {
				throw new ApiError("未找到可支付的医保订单，请重新授权", {
					code: "medical-insurance-order-not-found",
				});
			}
			if (!recovery.recoveryAllowed) {
				throw new ApiError("医保订单存在冲突，需要医院人工核实", {
					statusCode: 409,
					code: "payment-notification-conflict",
				});
			}
			if (recovery.status === "insurance_settled") {
				this.redirectCompleted(recovery);
				return;
			}
			if (recovery.status !== "cash_pending") {
				await resumeMedicalSettlementFromPending(
					createMedicalPaymentContext({
						...business,
						order: recovery,
						phase: "medical_processing",
					}),
					progress,
				);
				recovery = await queryMedicalBusinessRecovery(business);
			}
			if (!recovery) {
				throw new ApiError("医保订单状态不可用", {
					code: "medical-insurance-order-not-found",
				});
			}
			if (recovery.status === "insurance_settled") {
				this.redirectCompleted(recovery);
				return;
			}
			if (recovery.status !== "cash_pending" || !hasAmounts(recovery)) {
				throw new ApiError("医保结算仍在确认，请稍后再次查询", {
					code: "payment-prepay-in-progress",
				});
			}
			await resumeOrContinueMedicalCashPaymentFromPending(
				createMedicalPaymentContext({
					...business,
					order: recovery,
					phase: "cash_payment",
				}),
				progress,
			);
			const completed = await queryMedicalBusinessRecovery(business);
			if (completed?.status === "insurance_settled") {
				this.redirectCompleted(completed);
				return;
			}
			throw new ApiError("医保支付仍在确认，请稍后再次点击去支付查询", {
				code: "payment-prepay-in-progress",
			});
		} catch (error) {
			this.setData({
				error: "",
				paymentMessage: errorMessageWithCode(
					error,
					"医保支付未完成，请稍后再次点击去支付查询",
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

	onLoadingTouchMove(): void {
		// 加载遮罩期间阻止底层结算页面滚动或触发操作。
	},

	onUnload(): void {
		clearMedicalInsuranceAuthHandoff({
			businessType: "outpatient",
			businessId: this.data.recordId,
			patientId: this.data.patientId,
		});
		disposePageSessionResetListener(this);
	},
});
