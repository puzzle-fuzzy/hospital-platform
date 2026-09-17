import {
	ApiError,
	contextualApiErrorMessage,
	getCurrentUser,
	requestAppointmentDetail,
	requestAppointmentPaymentExit,
} from "../../services/api-client";
import { loadCurrentPatientForOwner } from "../../services/dashboard-service";
import { errorMessageWithCode } from "../../services/error-presentation";
import {
	canSwitchMedicalAuthorizationToSelfPay,
	clearPendingPayment,
	continueMedicalCashierPaymentFromPending,
	continueMedicalPayment,
	continueSelfPaymentFromPending,
	MedicalAuthNavigationCancelledError,
	MedicalCashRequiredError,
	MedicalInsurancePaymentFailureError,
	navigateToMedicalAuth,
	type PaymentMode,
	prepareFreshMedicalAuthorization,
	readPendingPayment,
	resumeMedicalCashPaymentFromPending,
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
	sessionGeneration: number;
	/** 从挂号详情进入时自动启动医保流程；预约确认页进入时保持手动选择。 */
	autoStartMode: PaymentMode | "";
	autoStartInFlight: boolean;
};

type PaymentModeEvent = WechatMiniprogram.BaseEvent & {
	currentTarget?: { dataset?: { mode?: string } };
};

type MedicalApp = {
	globalData: { medicalInsuranceAuthCode: string };
};

let resumingPayment = false;
let paymentCompletionRedirecting = false;

function appointmentDetailUrl(
	appointmentId: string,
	patientId: string,
): string {
	return `/pages/appointment-detail/appointment-detail?patientId=${encodeURIComponent(patientId)}&appointmentId=${encodeURIComponent(appointmentId)}`;
}

/** 纯医保订单和混合医保订单共用“医保支付”入口，每次点击都是新的尝试。 */
function paymentButtonMode(mode: PaymentMode | undefined): PaymentMode | "" {
	return mode === "medical" ? "mixed" : (mode ?? "");
}

function autoStartPaymentMode(value: string | undefined): PaymentMode | "" {
	return value === "mixed" ? "mixed" : "";
}

const STAGE_TEXT: Record<string, string> = {
	preparing: "正在准备支付订单，请勿重复点击或重新预约",
	authorizing: "请在医保小程序完成授权，返回后请等待页面继续处理",
	insuring: "正在上传医保费用，请勿重复提交",
	settling: "正在进行医保结算，请勿重复授权或付款",
	polling: "正在确认医保结算结果，请勿重复操作",
	"cash-paying": "正在打开医保收银台，请勿重复点击",
	"cash-confirming": "正在确认医保支付并回写医院，请勿重复付款",
	"self-paying": "正在打开微信支付收银台，请勿重复点击",
	"self-confirming": "正在确认微信支付结果，请勿重复付款",
	success: "支付和医院结算已确认",
};

function confirmSelfPayAfterInsutypeUnavailable(): Promise<boolean> {
	return new Promise((resolve) => {
		wx.showModal({
			title: "当前无法使用医保",
			content:
				"当前就诊人没有可用于本次支付的有效医保参保信息，无法继续医保支付。预约已保留，是否改用微信支付？",
			confirmText: "改用微信支付",
			cancelText: "暂不支付",
			success: (result) => resolve(result.confirm),
			fail: () => resolve(false),
		});
	});
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
		return error.userMessage;
	// 50240 只表示前端确认窗口结束，不是用户需要看到的内部数字码。
	// .32 成功并形成最终订单状态时会进入成功分支；未确认时保留普通提示。
	if (
		error instanceof ApiError &&
		error.code === "payment-prepay-in-progress"
	) {
		return "支付结果正在确认，请稍后查看挂号详情";
	}
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
		return "当前医保支付包含微信支付金额，请继续医保支付";
	}
	if (error instanceof ApiError) {
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
			return "本次支付结果无法确认，支付上下文已清除，请重新点击医保支付；如已扣款请联系医院核实";
		}
		if (
			["wechat-payment-launch-failed", "wechat-pay-params-missing"].includes(
				error.code,
			)
		) {
			return "微信支付未完成，支付上下文已清除，请重新点击微信支付；如已扣款请联系医院核实";
		}
		if (error.code === "dependency-not-configured") {
			return "支付服务暂时不可用，本次支付上下文已清除，请重新点击支付方式";
		}
		if (error.code === "provider-request-rejected") {
			return "医院端未接受本次支付请求，支付上下文已清除，请重新点击医保支付";
		}
	}
	return "支付未完成，支付上下文已清除，请重新点击支付方式；如已扣款请联系医院核实";
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
		completePayment(message?: string): void;
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
		sessionGeneration: -1,
		autoStartMode: "",
		autoStartInFlight: false,
	},

	onLoad(options) {
		paymentCompletionRedirecting = false;
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
				sessionGeneration: -1,
				autoStartMode: "",
				autoStartInFlight: false,
			});
		});
		const appointmentId = decodeRouteValue(options.appointmentId);
		const patientId = decodeRouteValue(options.patientId);
		const autoStartMode = autoStartPaymentMode(options.mode);
		this.setData({ appointmentId, patientId, autoStartMode });
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
		// 详情页的医保入口要求这次点击从新流程开始；在自动启动完成前，
		// 不能让 onShow 抢先恢复本地旧支付上下文。
		if (this.data.autoStartMode || this.data.autoStartInFlight) {
			const app = getApp<MedicalApp>();
			if (app?.globalData) app.globalData.medicalInsuranceAuthCode = "";
			return;
		}
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
			selectedMode: paymentButtonMode(pending.mode),
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
					if (completed) {
						this.completePayment();
						return;
					}
					this.setData({
						hasPendingPayment: false,
						completed: false,
						message: "上次医保支付未确认，支付上下文已清除，请重新点击医保支付",
					});
				})
				.catch((error: unknown) => {
					clearPendingPayment();
					this.setData({
						hasPendingPayment: false,
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
						"检测到未完成的医保支付，请点击医保支付继续；请勿重复付款或重新预约",
				});
			} else if (pending.phase === "medical_cash_required") {
				this.setData({
					stage: "settling",
					message:
						"当前医保订单包含微信支付金额，请继续医保支付；请勿重复付款或重新预约",
				});
			} else {
				this.setData({
					stage: "self-confirming",
					message:
						"检测到未完成的微信支付，请点击微信支付继续；请勿重复付款或重新预约",
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
			if (!remaining) {
				this.completePayment();
			} else {
				this.setData({ hasPendingPayment: true, completed: false });
			}
		} catch (error) {
			await this.handlePaymentError(error);
		} finally {
			resumingPayment = false;
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

	async startOrResumePayment(mode: PaymentMode): Promise<void> {
		if (this.data.busy) return;
		this.setData({
			busy: true,
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
			let pending = readPendingPayment();
			if (
				pending &&
				pending.appointmentId !== this.data.appointmentId &&
				mode !== "mixed"
			) {
				throw new ApiError("已有其他挂号支付在处理中，请先完成或退出", {
					code: "payment-prepay-in-progress",
				});
			}
			// 混合支付是一次新的支付尝试，不恢复本地旧的医保订单或 504 状态。
			if (mode === "mixed" && pending) {
				if (pending.appointmentId !== this.data.appointmentId) {
					try {
						await requestAppointmentPaymentExit(
							pending.appointmentId,
							pending.mode ?? "mixed",
						);
					} catch (error) {
						console.warn(
							"[医保支付] 清理其他预约的旧支付上下文失败，继续新流程",
							error,
						);
					}
				}
				clearPendingPayment();
				this.setData({
					hasPendingPayment: false,
					completed: false,
				});
				pending = null;
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
				this.completePayment("挂号和微信支付成功");
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
			if (mode !== "medical" && mode !== "mixed") {
				this.setData({
					message:
						"当前是历史医保收银台订单，请选择医保支付继续确认；请勿重复付款",
				});
				return;
			}
			const completed = await continueMedicalCashierPaymentFromPending(
				pending,
				(stage, message) => this.setData({ stage, message, error: "" }),
			);
			if (completed) this.completePayment();
			return;
		}
		if (pending.phase === "self_payment") {
			if (mode !== "self") {
				this.setData({
					message:
						"当前已有微信支付订单，请继续微信支付；请勿重复付款或重新预约",
				});
				return;
			}
			await continueSelfPaymentFromPending(pending, (stage, message) =>
				this.setData({ stage, message, error: "" }),
			);
			this.completePayment("挂号和微信支付成功");
			return;
		}
		if (pending.phase === "medical_cash_required") {
			if (mode !== "mixed") {
				this.setData({
					message:
						"当前医保订单包含微信支付金额，请继续医保支付；请勿重复付款或重新预约",
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
				this.setData({
					hasPendingPayment: false,
					completed: false,
					message: "支付结果未确认，支付上下文已清除，请重新点击医保支付",
				});
				return;
			}
			this.completePayment();
			return;
		}
		if (pending.phase === "cash_payment") {
			if (mode !== "mixed" && mode !== "medical") {
				this.setData({
					message: "当前是医保支付订单，请选择医保支付继续确认；请勿重复付款",
				});
				return;
			}
			const confirmed = await resumeMedicalCashPaymentFromPending(
				pending,
				(stage, message) => this.setData({ stage, message, error: "" }),
				1,
			);
			if (confirmed) {
				this.completePayment();
				return;
			}
			this.setData({
				hasPendingPayment: false,
				completed: false,
				message: "支付结果未确认，支付上下文已清除，请重新点击医保支付",
			});
			return;
		}
		if (mode === "self") {
			if (canSwitchMedicalAuthorizationToSelfPay(pending)) {
				await startSelfPayment(
					{
						appointmentId: pending.appointmentId,
						patientId: pending.patientId,
					},
					(stage, message) => this.setData({ stage, message, error: "" }),
				);
				this.completePayment("挂号和微信支付成功");
				return;
			}
			this.setData({
				message:
					"当前预约已进入医保流程，不能切换为微信支付；请先继续原医保支付，请勿重复付款或重新预约",
			});
			return;
		}
		const freshAuthorization = prepareFreshMedicalAuthorization(pending, mode);
		this.setData({
			stage: "authorizing",
			message: STAGE_TEXT.authorizing ?? "请在医保小程序完成授权",
		});
		await navigateToMedicalAuth(freshAuthorization.appointmentId);
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
					stage: "",
					error: "",
					message: "已取消支付，预约已保留；可返回上一页或稍后重新选择支付",
				});
				return;
			}
			// 用户取消收银台只代表本次支付尝试退出，不能取消已写入的预约。
			// 保留 pending 让用户稍后从本页或返回详情继续原订单，避免 30440。
			this.setData({
				hasPendingPayment: true,
				stage: "",
				error: "",
				message: "已取消支付，预约已保留；可稍后点击原支付方式继续",
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
		const pending = readPendingPayment();
		if (
			error instanceof ApiError &&
			error.code === "medical-insurance-insutype-unavailable" &&
			canSwitchMedicalAuthorizationToSelfPay(pending)
		) {
			this.setData({
				hasPendingPayment: true,
				stage: "",
				error: "",
				message: "当前就诊人暂无有效医保参保信息，预约已保留",
			});
			const confirmed = await confirmSelfPayAfterInsutypeUnavailable();
			if (!confirmed) {
				this.setData({
					message: "已暂不支付，可稍后点击“微信支付”继续，无需重新挂号",
				});
				return;
			}
			this.setData({ selectedMode: "self", error: "" });
			try {
				await startSelfPayment(
					{
						appointmentId: pending.appointmentId,
						patientId: pending.patientId,
					},
					(stage, message) => this.setData({ stage, message, error: "" }),
				);
				this.completePayment("挂号和微信支付成功");
			} catch (selfPayError) {
				await this.handlePaymentError(selfPayError);
			}
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
			hasPendingPayment: false,
			error: paymentError(error),
			message: paymentActionMessage(error),
			completed: false,
		});
	},

	completePayment(message = "挂号和医保支付成功"): void {
		if (paymentCompletionRedirecting) return;
		paymentCompletionRedirecting = true;
		const { appointmentId, patientId } = this.data;
		this.setData({
			hasPendingPayment: false,
			completed: true,
			busy: false,
			stage: "success",
			error: "",
			message,
		});
		if (!appointmentId || !patientId) {
			paymentCompletionRedirecting = false;
			return;
		}
		wx.redirectTo({
			url: appointmentDetailUrl(appointmentId, patientId),
			fail: () => {
				paymentCompletionRedirecting = false;
				// 跳转失败时保留成功页和“查看挂号详情”按钮，不能把已完成支付误报为失败。
				this.setData({ completed: true, busy: false, error: "" });
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
		paymentCompletionRedirecting = false;
		disposePageSessionResetListener(this);
	},
});
