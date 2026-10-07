import {
	ApiError,
	contextualApiErrorMessage,
	getCurrentUser,
	requestAppointmentDetail,
} from "../../services/api-client";
import { loadCurrentPatientForOwner } from "../../services/dashboard-service";
import {
	continueMedicalPayment,
	createMedicalPaymentContext,
	MedicalAuthNavigationCancelledError,
	MedicalCashRequiredError,
	MedicalInsurancePaymentFailureError,
	type PaymentMode,
	type PaymentProgress,
	queryMedicalBusinessRecovery,
	resumeMedicalSettlementFromPending,
	startMedicalPayment,
	startSelfPayment,
	WechatPaymentCancelledError,
} from "../../services/medical-insurance";
import {
	clearMedicalInsuranceAuthHandoff,
	consumeMedicalInsuranceAuthReturn,
	hasMedicalInsuranceAuthReturn,
} from "../../services/medical-insurance-auth-handoff";
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
	registrationClassName: string;
	hospitalAreaName: string;
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
	completionRedirecting: boolean;
	sessionGeneration: number;
	/** 从挂号详情进入时自动启动医保流程；预约确认页进入时保持手动选择。 */
	autoStartMode: PaymentMode | "";
	autoStartInFlight: boolean;
};

type PaymentModeEvent = WechatMiniprogram.BaseEvent & {
	currentTarget?: { dataset?: { mode?: string } };
};

function appointmentDetailUrl(
	appointmentId: string,
	patientId: string,
): string {
	return `/pages/appointment-detail/appointment-detail?patientId=${encodeURIComponent(patientId)}&appointmentId=${encodeURIComponent(appointmentId)}`;
}

function paymentResultUrl(
	appointmentId: string,
	patientId: string,
	channel: "medical" | "wechat",
	options?: { orderId?: string },
): string {
	const orderId = options?.orderId
		? `&orderId=${encodeURIComponent(options.orderId)}`
		: "";
	return `/pages/payment-result/payment-result?business=registration&channel=${channel}&patientId=${encodeURIComponent(patientId)}&appointmentId=${encodeURIComponent(appointmentId)}${orderId}`;
}

function autoStartPaymentMode(value: string | undefined): PaymentMode | "" {
	return value === "mixed" ? "mixed" : "";
}

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
		return "当前医保支付包含微信支付金额，请继续医保支付";
	if (error instanceof MedicalInsurancePaymentFailureError)
		return "医保支付未完成，请联系医院确认支付状态";
	// 支付确认窗口结束时只展示当前状态，不向用户暴露内部数字码或上游原因。
	if (
		error instanceof ApiError &&
		error.code === "payment-prepay-in-progress"
	) {
		return "支付结果正在确认，请稍后查看挂号详情";
	}
	return contextualApiErrorMessage(error, "支付流程未完成，请稍后重试");
}

function paymentActionMessage(error: unknown): string {
	if (error instanceof MedicalInsurancePaymentFailureError) {
		return "医保支付未完成，原订单和预约已保留；请勿重复付款，联系医院确认支付状态";
	}
	if (error instanceof MedicalCashRequiredError) {
		return "当前医保支付包含微信支付金额，请继续医保支付";
	}
	if (error instanceof ApiError) {
		if (error.code === "medical-insurance-timeout") {
			return "医保连接超时，请稍后重新挂号重试";
		}
		if (error.code === "payment-prepay-in-progress") {
			return "支付结果正在确认，预约已保留，请稍后查看挂号详情；如已扣款请联系医院核实";
		}
		if (
			[
				"network-failed",
				"request-timeout",
				"payment-prepay-unknown",
				"payment-notification-conflict",
			].includes(error.code)
		) {
			return "本次支付结果无法确认，原订单已保留；请稍后点击原支付方式查询，如已扣款请勿重复付款";
		}
		if (
			["wechat-payment-launch-failed", "wechat-pay-params-missing"].includes(
				error.code,
			)
		) {
			return "微信支付未完成，原订单已保留；请稍后点击原支付方式查询，如已扣款请勿重复付款";
		}
		if (error.code === "dependency-not-configured") {
			return "支付服务暂时不可用，当前支付状态已保留，请稍后继续原订单";
		}
		if (error.code === "provider-request-rejected") {
			return "医院端未接受本次支付请求，原订单已保留；请勿重复付款并联系医院核实";
		}
	}
	return "支付未完成，当前订单状态已保留；请稍后继续原支付方式，如已扣款请勿重复付款";
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
		continueServerMedicalPayment(authCode?: string): Promise<void>;
		handlePaymentError(error: unknown): Promise<void>;
		completePayment(message?: string, serverResult?: { orderId: string }): void;
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
		registrationClassName: "",
		hospitalAreaName: "",
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
		completionRedirecting: false,
		sessionGeneration: -1,
		autoStartMode: "",
		autoStartInFlight: false,
	},

	onLoad(options) {
		registerPageSessionResetListener(this, () => {
			clearMedicalInsuranceAuthHandoff();
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
				registrationClassName: "",
				hospitalAreaName: "",
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
				completionRedirecting: false,
				sessionGeneration: -1,
				autoStartMode: "",
				autoStartInFlight: false,
			});
		});
		const appointmentId = decodeRouteValue(options.appointmentId);
		const patientId = decodeRouteValue(options.patientId);
		const autoStartMode = autoStartPaymentMode(options.mode);
		this.setData({
			appointmentId,
			patientId,
			autoStartMode,
			completionRedirecting: false,
		});
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
				registrationClassName: detail.data.registrationClassName ?? "",
				hospitalAreaName: detail.data.hospitalAreaName ?? "",
				doctorName: detail.data.doctorName,
				workDate: detail.data.workDate,
				shiftName: detail.data.shiftName,
				workTime: detail.data.workTime ?? "",
				sourceSerialNumber: detail.data.sourceSerialNumber,
				totalLabel: `${(detail.data.totalFen / 100).toFixed(2)} 元`,
				sessionGeneration: context.sessionGeneration,
			});
			if (
				hasMedicalInsuranceAuthReturn({
					businessType: "registration",
					businessId: this.data.appointmentId,
					patientId: context.patient.id,
				})
			) {
				this.setData({ autoStartMode: "" });
				void this.handleReturn();
				return;
			}
			const autoStartMode = this.data.autoStartMode;
			if (autoStartMode) {
				// 只消费一次路由启动标记，避免页面重载或返回时重复创建支付流程。
				this.setData({ autoStartMode: "", autoStartInFlight: true });
				void this.startOrResumePayment(autoStartMode).finally(() => {
					this.setData({ autoStartInFlight: false });
				});
			}
		} catch (error) {
			this.setData({
				loading: false,
				ready: false,
				error: paymentError(error),
			});
		}
	},

	async handleReturn(): Promise<void> {
		if (this.data.busy || !this.data.ready) return;
		const authCode = consumeMedicalInsuranceAuthReturn({
			businessType: "registration",
			businessId: this.data.appointmentId,
			patientId: this.data.patientId,
		});
		if (!authCode) return;
		this.setData({
			busy: true,
			error: "",
			stage: "insuring",
			message: "正在调用医保授权接口，请勿重复提交",
		});
		try {
			await this.continueServerMedicalPayment(authCode);
		} catch (error) {
			await this.handlePaymentError(error);
		} finally {
			this.setData({ busy: false });
		}
	},

	onPaymentTap(event) {
		const value = String(event.currentTarget?.dataset?.mode || "");
		if (value !== "mixed" && value !== "self") return;
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

	async continueServerMedicalPayment(authCode?: string): Promise<void> {
		const business = {
			businessType: "registration" as const,
			businessId: this.data.appointmentId,
			patientId: this.data.patientId,
		};
		let recovery = await queryMedicalBusinessRecovery(business);
		if (recovery && !recovery.recoveryAllowed) {
			throw new ApiError("医保订单存在冲突，需要医院人工核实", {
				statusCode: 409,
				code: "payment-notification-conflict",
			});
		}
		const progress = (stage: PaymentProgress, message: string) =>
			this.setData({ stage, message, error: "" });
		if (authCode) {
			const pending = createMedicalPaymentContext({
				...business,
				...(recovery ? { order: recovery } : {}),
				phase: "authorization",
			});
			await continueMedicalPayment(authCode, pending, progress);
		} else if (recovery?.authorizationPending) {
			this.setData({
				hasPendingPayment: true,
				completed: false,
				stage: "polling",
				message:
					"上一次医保授权正在确认；按钮已恢复，可稍后再次点击查询，请勿重复展码",
			});
			return;
		} else if (
			!recovery ||
			(recovery.status === "created" && !recovery.authorizationReady)
		) {
			await startMedicalPayment(
				{
					appointmentId: this.data.appointmentId,
					patientId: this.data.patientId,
				},
				progress,
				"mixed",
			);
			return;
		} else {
			const pending = createMedicalPaymentContext({
				...business,
				order: recovery,
				phase: "medical_processing",
			});
			await resumeMedicalSettlementFromPending(pending, progress);
		}

		recovery = await queryMedicalBusinessRecovery(business);
		if (recovery?.status === "insurance_settled") {
			this.completePayment("挂号和医保支付成功", {
				orderId: recovery.orderId,
				...(recovery.amounts ? { totalFen: recovery.amounts.totalFen } : {}),
			});
			return;
		}
		this.setData({
			hasPendingPayment: Boolean(recovery),
			completed: false,
			stage: "polling",
			message: "医保订单尚未完成；可再次点击医保支付，系统会重新查询服务端状态",
		});
	},

	async startOrResumePayment(mode: PaymentMode): Promise<void> {
		if (this.data.busy) return;
		this.setData({
			busy: true,
			selectedMode: mode,
			error: "",
			stage: "preparing",
			message:
				mode === "self"
					? "正在准备微信支付，请勿重复点击或重新预约"
					: mode === "mixed"
						? "正在准备医保支付，请勿重复点击"
						: "正在准备医保支付，请勿重复点击",
		});
		try {
			if (mode !== "self") {
				await this.continueServerMedicalPayment();
				return;
			}
			const medicalOrder = await queryMedicalBusinessRecovery({
				businessType: "registration",
				businessId: this.data.appointmentId,
				patientId: this.data.patientId,
			});
			if (medicalOrder) {
				throw new ApiError(
					"当前预约已有医保订单，请先通过医保支付查询并完成原订单",
					{ code: "payment-prepay-in-progress" },
				);
			}
			const appointment = {
				appointmentId: this.data.appointmentId,
				patientId: this.data.patientId,
			};
			const result = await startSelfPayment(appointment, (stage, message) =>
				this.setData({ stage, message, error: "" }),
			);
			this.completePayment("挂号和微信支付成功", result);
		} catch (error) {
			await this.handlePaymentError(error);
		} finally {
			this.setData({ busy: false });
		}
	},

	async handlePaymentError(error: unknown): Promise<void> {
		if (
			error instanceof MedicalAuthNavigationCancelledError ||
			error instanceof WechatPaymentCancelledError
		) {
			// 用户取消收银台只代表本次支付尝试退出，不能取消已写入的预约。
			// 不保存按钮或订单上下文；再次点击时由服务端业务键恢复同一订单。
			this.setData({
				hasPendingPayment: this.data.selectedMode === "self",
				stage: "",
				error: "",
				message:
					"已取消本次支付操作，预约已保留；可再次点击原支付方式查询服务端订单",
			});
			return;
		}
		if (error instanceof MedicalCashRequiredError) {
			this.setData({
				hasPendingPayment: true,
				message:
					"当前医保支付包含微信支付金额，请继续医保支付；请勿重复付款或重新预约",
				error: "",
			});
			return;
		}
		if (
			error instanceof ApiError &&
			error.code === "medical-insurance-insutype-unavailable"
		) {
			this.setData({
				hasPendingPayment: false,
				stage: "",
				error: "",
				message:
					"当前就诊人暂无有效医保参保信息，预约已保留；医保订单状态以服务端为准，请勿直接重复付款",
			});
			return;
		}
		if (
			error instanceof ApiError &&
			error.code === "medical-insurance-appointment-stale"
		) {
			this.setData({
				hasPendingPayment: false,
				error: "",
				message: "当前预约已失效，请返回重新选择号源",
			});
			return;
		}
		this.setData({
			// 仅表示本页需要继续查询；按钮在 finally 中恢复，下一次点击仍会
			// 重新读取服务端，不保存任何客户端支付状态。
			hasPendingPayment: true,
			error: "",
			message: paymentActionMessage(error),
			completed: false,
		});
	},

	completePayment(
		message = "挂号和医保支付成功",
		serverResult?: { orderId: string },
	): void {
		if (this.data.completionRedirecting) return;
		const { appointmentId, patientId } = this.data;
		this.setData({
			hasPendingPayment: false,
			completed: true,
			busy: false,
			stage: "success",
			error: "",
			message,
			completionRedirecting: true,
		});
		if (!appointmentId || !patientId) {
			this.setData({ completionRedirecting: false });
			return;
		}
		wx.redirectTo({
			url: paymentResultUrl(
				appointmentId,
				patientId,
				this.data.selectedMode === "self" ? "wechat" : "medical",
				serverResult,
			),
			fail: () => {
				// 跳转失败时保留成功页和“查看挂号详情”按钮，不能把已完成支付误报为失败。
				this.setData({
					completed: true,
					busy: false,
					error: "",
					completionRedirecting: false,
				});
			},
		});
	},

	onOpenDetail() {
		if (!this.data.appointmentId || !this.data.patientId) return;
		wx.navigateTo({
			url: appointmentDetailUrl(this.data.appointmentId, this.data.patientId),
		});
	},

	onBack() {
		wx.navigateBack();
	},

	onUnload() {
		clearMedicalInsuranceAuthHandoff({
			businessType: "registration",
			businessId: this.data.appointmentId,
			patientId: this.data.patientId,
		});
		disposePageSessionResetListener(this);
	},
});
