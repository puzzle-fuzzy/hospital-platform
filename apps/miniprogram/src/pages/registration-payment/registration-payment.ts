import {
	ApiError,
	contextualApiErrorMessage,
	getCurrentUser,
	requestAppointmentDetail,
} from "../../services/api-client";
import { loadCurrentPatientForOwner } from "../../services/dashboard-service";
import { errorMessageWithCode } from "../../services/error-presentation";
import {
	clearPendingPayment,
	continueMedicalCashierPaymentFromPending,
	continueMedicalCashPayment,
	continueMedicalPayment,
	continueSelfPaymentFromPending,
	exitPayment,
	MedicalAuthNavigationCancelledError,
	MedicalCashRequiredError,
	MedicalInsurancePaymentFailureError,
	navigateToMedicalAuth,
	type PaymentMode,
	readPendingPayment,
	resumeMedicalCashPaymentFromPending,
	setPendingPaymentMode,
	startMedicalPayment,
	startSelfPayment,
	WechatPaymentCancelledError,
} from "../../services/medical-insurance";
import { assertSessionGeneration } from "../../services/session-boundary";
import {
	disposePageSessionResetListener,
	registerPageSessionResetListener,
} from "../../services/session-events";

type RegistrationPaymentPageData = {
	loading: boolean;
	appointmentId: string;
	patientId: string;
	patientName: string;
	patientRelationship: string;
	patientCardLabel: string;
	hospitalName: string;
	departmentName: string;
	doctorName: string;
	workDate: string;
	shiftName: string;
	workTime: string;
	sourceSerialNumber: string;
	totalLabel: string;
	ready: boolean;
	busy: boolean;
	hasPendingPayment: boolean;
	selectedMode: PaymentMode | "";
	stage: string;
	message: string;
	error: string;
	completed: boolean;
	sessionGeneration: number;
};

type PaymentModeEvent = WechatMiniprogram.BaseEvent & {
	currentTarget?: { dataset?: { mode?: string } };
};

type MedicalApp = {
	globalData: { medicalInsuranceAuthCode: string };
};

let resumingPayment = false;

const STAGE_TEXT: Record<string, string> = {
	preparing: "正在准备支付订单，请勿重复点击或重新预约",
	authorizing: "请在医保小程序完成授权，返回后请等待页面继续处理",
	insuring: "正在上传医保费用，请勿重复提交",
	settling: "正在进行医保结算，请勿重复授权或付款",
	polling: "正在确认医保结算结果，请勿重复操作",
	"cash-paying": "正在打开医保自费收银台，请勿重复点击",
	"cash-confirming": "正在确认医保支付并回写医院，请勿重复付款",
	"self-paying": "正在打开微信自费收银台，请勿重复点击",
	"self-confirming": "正在确认微信自费支付结果，请勿重复付款",
	success: "支付和医院结算已确认",
};

function decodeRouteValue(value: string | undefined): string {
	if (typeof value !== "string") return "";
	try {
		return decodeURIComponent(value).trim();
	} catch {
		return "";
	}
}

function paymentError(error: unknown): string {
	if (
		error instanceof MedicalAuthNavigationCancelledError ||
		error instanceof WechatPaymentCancelledError
	)
		return "";
	if (error instanceof MedicalCashRequiredError)
		return "当前医保结算包含自费金额，请选择医保混合支付";
	if (error instanceof MedicalInsurancePaymentFailureError)
		return error.userMessage;
	return errorMessageWithCode(
		error,
		contextualApiErrorMessage(error, "支付流程未完成，请稍后重试"),
	);
}

function paymentActionMessage(error: unknown): string {
	if (error instanceof MedicalInsurancePaymentFailureError) {
		return "医保扣款失败，系统已停止继续结算；退款状态需医院核实，请勿重复付款，并联系医院确认";
	}
	if (error instanceof MedicalCashRequiredError) {
		return "当前医保结算包含自费金额，请选择医保混合支付";
	}
	if (error instanceof ApiError) {
		if (
			[
				"network-failed",
				"request-timeout",
				"payment-prepay-in-progress",
				"payment-prepay-unknown",
				"payment-notification-conflict",
			].includes(error.code)
		) {
			return "支付结果暂时无法确认，预约已保留，请稍后点击原支付方式继续确认；请勿重复预约或重复付款";
		}
		if (
			["wechat-payment-launch-failed", "wechat-pay-params-missing"].includes(
				error.code,
			)
		) {
			return "微信支付未完成，预约已保留，请稍后重新发起支付；如已扣款，请先点击继续确认，勿重复付款";
		}
		if (error.code === "dependency-not-configured") {
			return "支付服务暂时不可用，预约已保留，请稍后重试或联系工作人员";
		}
		if (error.code === "provider-request-rejected") {
			return "医院端未接受本次支付请求，预约已保留；请勿重复提交，请联系工作人员核实后再试";
		}
	}
	return "支付未完成，预约已保留，请按照当前支付方式继续确认；请勿重复预约或重复付款";
}

Page<
	RegistrationPaymentPageData,
	{
		onLoad(options: Record<string, string | undefined>): void;
		onShow(): void;
		loadDetail(): Promise<void>;
		handleReturn(): Promise<void>;
		onPaymentTap(event: PaymentModeEvent): void;
		startOrResumePayment(mode: PaymentMode): Promise<void>;
		resumePendingPayment(
			pending: NonNullable<ReturnType<typeof readPendingPayment>>,
			mode: PaymentMode,
		): Promise<void>;
		handlePaymentError(error: unknown): Promise<void>;
		onOpenDetail(): void;
		onBack(): void;
		onUnload(): void;
	}
>({
	data: {
		loading: true,
		appointmentId: "",
		patientId: "",
		patientName: "",
		patientRelationship: "",
		patientCardLabel: "",
		hospitalName: "高平市人民医院",
		departmentName: "",
		doctorName: "",
		workDate: "",
		shiftName: "",
		workTime: "",
		sourceSerialNumber: "",
		totalLabel: "以医院实际收费为准",
		ready: false,
		busy: false,
		hasPendingPayment: false,
		selectedMode: "",
		stage: "",
		message: "",
		error: "",
		completed: false,
		sessionGeneration: -1,
	},

	onLoad(options) {
		registerPageSessionResetListener(this, () => {
			const app = getApp<MedicalApp>();
			if (app?.globalData) app.globalData.medicalInsuranceAuthCode = "";
			this.setData({
				loading: false,
				ready: false,
				busy: false,
				hasPendingPayment: false,
				appointmentId: "",
				patientId: "",
				patientName: "",
				patientRelationship: "",
				patientCardLabel: "",
				departmentName: "",
				doctorName: "",
				workDate: "",
				shiftName: "",
				workTime: "",
				sourceSerialNumber: "",
				totalLabel: "",
				stage: "",
				message: "",
				error: "登录状态已更新，请返回后重新选择就诊人",
				completed: false,
				sessionGeneration: -1,
			});
		});
		const appointmentId = decodeRouteValue(options.appointmentId);
		const patientId = decodeRouteValue(options.patientId);
		this.setData({ appointmentId, patientId });
		if (!appointmentId || !patientId) {
			this.setData({
				loading: false,
				error: "挂号支付引用已失效，请返回挂号详情重试",
			});
			return;
		}
		void this.loadDetail();
	},

	onShow() {
		void this.handleReturn();
	},

	async loadDetail(): Promise<void> {
		this.setData({ loading: true, error: "" });
		try {
			const currentUser = await getCurrentUser();
			const context = await loadCurrentPatientForOwner(
				currentUser.data.user.id,
			);
			assertSessionGeneration(
				context.sessionGeneration,
				"Registration payment page session changed before detail request",
			);
			if (context.patient.id !== this.data.patientId) {
				throw new ApiError("当前就诊人已变更，请重新选择", {
					code: "patient-selection-required",
				});
			}
			const detail = await requestAppointmentDetail(
				this.data.appointmentId,
				this.data.patientId,
				context.sessionGeneration,
			);
			assertSessionGeneration(
				context.sessionGeneration,
				"Registration payment page session changed before detail commit",
			);
			this.setData({
				loading: false,
				ready: true,
				patientName: detail.data.patient.displayName,
				patientRelationship: context.patient.relationship,
				patientCardLabel:
					detail.data.patient.cardNumberMasked === "未绑定"
						? "就诊卡未绑定"
						: `就诊卡：${detail.data.patient.cardNumberMasked}`,
				hospitalName: detail.data.hospitalName,
				departmentName: detail.data.departmentName,
				doctorName: detail.data.doctorName,
				workDate: detail.data.workDate,
				shiftName: detail.data.shiftName,
				workTime: detail.data.workTime ?? "",
				sourceSerialNumber: detail.data.sourceSerialNumber,
				totalLabel: `${(detail.data.totalFen / 100).toFixed(2)} 元`,
				sessionGeneration: context.sessionGeneration,
			});
		} catch (error) {
			this.setData({
				loading: false,
				ready: false,
				error: paymentError(error),
			});
		}
	},

	async handleReturn(): Promise<void> {
		const pending = readPendingPayment();
		const app = getApp<MedicalApp>();
		const authCode = String(
			app?.globalData?.medicalInsuranceAuthCode || "",
		).trim();
		if (!pending || pending.appointmentId !== this.data.appointmentId) {
			if (authCode && app?.globalData)
				app.globalData.medicalInsuranceAuthCode = "";
			return;
		}
		this.setData({
			hasPendingPayment: true,
			selectedMode: pending.mode ?? "mixed",
		});
		if (!authCode && pending.phase === "cash_payment" && !resumingPayment) {
			resumingPayment = true;
			this.setData({
				busy: true,
				error: "",
				stage: "cash-confirming",
				message: "正在确认微信医保支付并回写医院，请勿重复付款",
			});
			void resumeMedicalCashPaymentFromPending(pending, (stage, message) =>
				this.setData({ stage, message, error: "" }),
			)
				.then((completed) => {
					this.setData({
						hasPendingPayment: !completed,
						completed,
						message: completed
							? "挂号和医保混合支付成功"
							: "微信医保支付仍在确认，请稍后点击医保混合支付继续确认；请勿重复付款",
					});
				})
				.catch((error: unknown) => {
					this.setData({
						hasPendingPayment: Boolean(readPendingPayment()),
						error: paymentError(error),
						message: paymentActionMessage(error),
					});
				})
				.finally(() => {
					resumingPayment = false;
					this.setData({ busy: false });
				});
			return;
		}
		if (pending.phase !== "authorization") {
			if (authCode && app?.globalData)
				app.globalData.medicalInsuranceAuthCode = "";
			if (pending.phase === "medical_cashier") {
				this.setData({
					stage: "cash-confirming",
					message: "医保收银台已返回，请点击医保支付确认结果；请勿重复付款",
				});
			} else if (pending.phase === "cash_payment") {
				this.setData({
					stage: "cash-confirming",
					message:
						"检测到未完成的医保混合支付，请点击医保混合支付继续；请勿重复付款或重新预约",
				});
			} else if (pending.phase === "medical_cash_required") {
				this.setData({
					stage: "settling",
					message:
						"当前医保订单包含自费金额，请选择医保混合支付；请勿重复付款或重新预约",
				});
			} else {
				this.setData({
					stage: "self-confirming",
					message:
						"检测到未完成的微信自费支付，请点击自费支付继续；请勿重复付款或重新预约",
				});
			}
			return;
		}
		if (!authCode || resumingPayment) return;
		if (app?.globalData) app.globalData.medicalInsuranceAuthCode = "";
		resumingPayment = true;
		this.setData({
			busy: true,
			error: "",
			stage: "insuring",
			message: "正在调用医保授权接口，请勿重复提交",
		});
		try {
			await continueMedicalPayment(authCode, pending, (stage, message) =>
				this.setData({ stage, message, error: "" }),
			);
			const remaining = readPendingPayment();
			this.setData({
				hasPendingPayment: Boolean(remaining),
				completed: !remaining,
			});
		} catch (error) {
			await this.handlePaymentError(error);
		} finally {
			resumingPayment = false;
			this.setData({ busy: false });
		}
	},

	onPaymentTap(event) {
		const value = String(event.currentTarget?.dataset?.mode || "");
		if (value !== "medical" && value !== "mixed" && value !== "self") return;
		if (this.data.busy || !this.data.ready) return;
		try {
			assertSessionGeneration(
				this.data.sessionGeneration,
				"Registration payment page session changed before payment",
			);
		} catch (error) {
			this.setData({ ready: false, error: paymentError(error) });
			return;
		}
		const mode = value as PaymentMode;
		this.setData({ selectedMode: mode, error: "" });
		void this.startOrResumePayment(mode);
	},

	async startOrResumePayment(mode: PaymentMode): Promise<void> {
		if (this.data.busy) return;
		this.setData({
			busy: true,
			error: "",
			stage: "preparing",
			message:
				mode === "self"
					? "正在准备自费支付，请勿重复点击或重新预约"
					: mode === "mixed"
						? "正在准备医保混合支付，请勿重复点击"
						: "正在准备医保支付，请勿重复点击",
		});
		try {
			const pending = readPendingPayment();
			if (pending && pending.appointmentId !== this.data.appointmentId) {
				throw new ApiError("已有其他挂号支付在处理中，请先完成或退出", {
					code: "payment-prepay-in-progress",
				});
			}
			if (pending) {
				await this.resumePendingPayment(pending, mode);
				return;
			}
			const appointment = {
				appointmentId: this.data.appointmentId,
				patientId: this.data.patientId,
			};
			if (mode === "self") {
				await startSelfPayment(appointment, (stage, message) =>
					this.setData({ stage, message, error: "" }),
				);
				this.setData({ hasPendingPayment: false, completed: true });
			} else {
				await startMedicalPayment(
					appointment,
					(stage, message) => this.setData({ stage, message, error: "" }),
					mode,
				);
			}
		} catch (error) {
			await this.handlePaymentError(error);
		} finally {
			this.setData({ busy: false });
		}
	},

	async resumePendingPayment(
		pending: NonNullable<ReturnType<typeof readPendingPayment>>,
		mode: PaymentMode,
	): Promise<void> {
		if (pending.phase === "medical_cashier") {
			if (mode !== "medical") {
				this.setData({
					message:
						"当前是纯医保收银台订单，请选择医保支付继续确认；请勿重复付款",
				});
				return;
			}
			const completed = await continueMedicalCashierPaymentFromPending(
				pending,
				(stage, message) => this.setData({ stage, message, error: "" }),
			);
			if (completed)
				this.setData({ hasPendingPayment: false, completed: true });
			return;
		}
		if (pending.phase === "self_payment") {
			if (mode !== "self") {
				this.setData({
					message:
						"当前已有自费支付订单，请继续自费支付；请勿重复付款或重新预约",
				});
				return;
			}
			await continueSelfPaymentFromPending(pending, (stage, message) =>
				this.setData({ stage, message, error: "" }),
			);
			this.setData({ hasPendingPayment: false, completed: true });
			return;
		}
		if (pending.phase === "medical_cash_required") {
			if (mode !== "mixed") {
				this.setData({
					message:
						"当前医保订单包含自费金额，请选择医保混合支付；请勿重复付款或重新预约",
				});
				return;
			}
			const mixedPending = {
				...pending,
				mode: "mixed" as const,
				phase: "cash_payment" as const,
			};
			const confirmed = await resumeMedicalCashPaymentFromPending(
				mixedPending,
				(stage, message) => this.setData({ stage, message, error: "" }),
				1,
			);
			if (!confirmed) {
				await continueMedicalCashPayment(mixedPending, (stage, message) =>
					this.setData({ stage, message, error: "" }),
				);
			}
			this.setData({ hasPendingPayment: false, completed: true });
			return;
		}
		if (pending.phase === "cash_payment") {
			const expectedMode = pending.mode === "medical" ? "medical" : "mixed";
			if (mode !== expectedMode) {
				this.setData({
					message:
						expectedMode === "medical"
							? "当前是纯医保订单，请选择纯医保支付继续确认；请勿重复付款"
							: "当前是医保混合订单，请选择医保混合支付继续确认；请勿重复付款",
				});
				return;
			}
			const confirmed = await resumeMedicalCashPaymentFromPending(
				pending,
				(stage, message) => this.setData({ stage, message, error: "" }),
				1,
			);
			if (!confirmed) {
				await continueMedicalCashPayment(pending, (stage, message) =>
					this.setData({ stage, message, error: "" }),
				);
			}
			this.setData({ hasPendingPayment: false, completed: true });
			return;
		}
		if (mode === "self") {
			this.setData({
				message:
					"当前预约已进入医保流程，不能切换为自费支付；请先继续原医保支付，请勿重复付款或重新预约",
			});
			return;
		}
		setPendingPaymentMode(pending, mode);
		this.setData({
			stage: "authorizing",
			message: STAGE_TEXT.authorizing ?? "请在医保小程序完成授权",
		});
		await navigateToMedicalAuth(pending.appointmentId);
	},

	async handlePaymentError(error: unknown): Promise<void> {
		if (
			error instanceof MedicalAuthNavigationCancelledError ||
			error instanceof WechatPaymentCancelledError
		) {
			const pending = readPendingPayment();
			if (!pending) {
				this.setData({
					hasPendingPayment: false,
					message: "已取消支付，当前没有待处理支付；如需支付，请重新预约",
				});
				return;
			}
			try {
				await exitPayment(pending);
				this.setData({
					hasPendingPayment: false,
					message: "已取消支付，预约号源已释放；如需支付，请重新预约",
				});
			} catch (exitError) {
				this.setData({
					hasPendingPayment: true,
					error: paymentError(exitError),
					message:
						"支付已取消，但订单或号源尚未释放，请继续处理原支付；请勿重复预约或付款",
				});
			}
			return;
		}
		if (error instanceof MedicalCashRequiredError) {
			this.setData({
				hasPendingPayment: true,
				message:
					"当前医保结算包含自费金额，请选择医保混合支付；请勿重复付款或重新预约",
				error: "",
			});
			return;
		}
		if (
			error instanceof ApiError &&
			error.code === "medical-insurance-appointment-stale"
		) {
			clearPendingPayment();
			this.setData({
				hasPendingPayment: false,
				error: "",
				message: "当前预约已失效，原支付状态已清除，请返回重新选择号源",
			});
			return;
		}
		this.setData({
			hasPendingPayment: Boolean(readPendingPayment()),
			error: paymentError(error),
			message: paymentActionMessage(error),
		});
	},

	onOpenDetail() {
		if (!this.data.appointmentId || !this.data.patientId) return;
		wx.navigateTo({
			url: `/pages/appointment-detail/appointment-detail?patientId=${encodeURIComponent(this.data.patientId)}&appointmentId=${encodeURIComponent(this.data.appointmentId)}`,
		});
	},

	onBack() {
		wx.navigateBack();
	},

	onUnload() {
		disposePageSessionResetListener(this);
	},
});
