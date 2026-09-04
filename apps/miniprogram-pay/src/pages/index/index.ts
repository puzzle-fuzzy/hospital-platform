import { PAY_CONFIG } from "../../config";
import {
	type AppointmentRecord,
	type CreatedAppointment,
	cancelAppointment,
	createAppointment,
	holdAppointment,
	appointmentCandidateDates,
	loadSources,
	loadTargetSchedule,
	type Schedule,
	type Source,
	selectSource,
} from "../../services/appointment";
import {
	continueMedicalCashPayment,
	continueMedicalPayment,
	continueSelfPaymentFromPending,
	MedicalAuthNavigationCancelledError,
	MedicalCashRequiredError,
	navigateToMedicalAuth,
	type PaymentMode,
	type PaymentProgress,
	readPendingPayment,
	setPendingPaymentMode,
	startMedicalPayment,
	startSelfPayment,
	WechatPaymentCancelledError,
} from "../../services/medical-insurance";
import { loadPatients, mask, type Patient } from "../../services/patient";
import { ApiError } from "../../services/request";
import { ensureSession } from "../../services/session";

type PageData = {
	businessType: string;
	orderType: string;
	patients: Patient[];
	patientNames: string[];
	patientIndex: number;
	patientRelation: string;
	patientCard: string;
	targetDate: string;
	schedule: Schedule | null;
	source: Source | null;
	duplicate: AppointmentRecord | null;
	busy: boolean;
	hasPendingPayment: boolean;
	selectedMode: PaymentMode | "";
	stage: string;
	message: string;
	error: string;
};

type RegistrationProgress =
	| PaymentProgress
	| "loading-source"
	| "holding"
	| "registering";

let resumingPayment = false;

const progressText: Record<RegistrationProgress, string> = {
	"loading-source": "正在读取指定分时段",
	holding: "正在占用指定号源",
	registering: "正在写入预约",
	authorizing: "请在医保小程序完成授权",
	insuring: "正在上传医保费用",
	settling: "正在进行医保结算",
	polling: "正在确认医保结算结果",
	"cash-paying": "正在打开微信支付收银台",
	"cash-confirming": "正在确认微信医保混合支付结果",
	"self-paying": "正在打开微信自费支付收银台",
	"self-confirming": "正在确认微信自费支付结果",
	success: "挂号和医保支付成功",
};

function friendlyError(error: unknown): string {
	if (
		error instanceof MedicalAuthNavigationCancelledError ||
		error instanceof WechatPaymentCancelledError ||
		error instanceof MedicalCashRequiredError
	)
		return "";
	const message =
		error instanceof Error
			? error.message
			: typeof error === "object" && error !== null && "errMsg" in error
				? String((error as { errMsg?: unknown }).errMsg || "请求失败")
				: "请求失败，请查看开发者工具日志";
	return message.length > 80 ? `${message.slice(0, 80)}…` : message;
}

function showNavigationCancelled(page: PageInstance): void {
	page.setData({
		hasPendingPayment: Boolean(readPendingPayment()),
		error: "",
		message: "已取消跳转，预约已保留，请选择支付方式继续",
	});
}

function showWechatPaymentCancelled(page: PageInstance): void {
	page.setData({
		hasPendingPayment: Boolean(readPendingPayment()),
		error: "",
		message: "已取消微信支付，预约已保留，请选择原支付方式继续",
	});
}

type PageInstance = { setData(data: Partial<PageData>): void; data: PageData };

type PaymentModeEvent = WechatMiniprogram.BaseEvent & {
	currentTarget: { dataset: { mode?: string } };
};

function setProgress(
	page: PageInstance,
	stage: RegistrationProgress,
	message?: string,
): void {
	page.setData({ stage, message: message || progressText[stage], error: "" });
}

/**
 * 页面初始化时展示的号源只是目录快照；真正占号前必须重新读取一次。
 * 测试小程序可能同时被多人扫码使用，不能把首次加载时选中的 serial
 * 当作仍然可用的号源。服务端还会再次校验，这里只是把明显的过期窗口
 * 压缩到用户点击和提交之间。
 */
async function loadFreshRegistrationTarget(
	page: PageInstance,
): Promise<{ schedule: Schedule; source: Source }> {
	setProgress(page, "loading-source", "正在刷新当前可用号源");
	const schedule = await loadTargetSchedule();
	const source = selectSource(await loadSources(schedule));
	page.setData({ schedule, source, targetDate: schedule.workDate });
	return { schedule, source };
}

/**
 * 号源在“刷新列表 → 服务端实时复核”之间消失时，第一次请求没有创建 hold，
 * 因此只允许重新取一次号源并重试。其它错误不重试，避免把锁号、挂号费或
 * Provider 未知拒绝误当成可安全重放的号源竞争。
 */
async function registerWithFreshTarget(
	page: PageInstance,
	patient: Patient,
): Promise<CreatedAppointment | null> {
	const target = await loadFreshRegistrationTarget(page);
	try {
		return await registerOnce(page, patient, target.schedule, target.source);
	} catch (error) {
		if (
			!(error instanceof ApiError) ||
			error.code !== "appointment-source-unavailable"
		) {
			throw error;
		}
		const retryTarget = await loadFreshRegistrationTarget(page);
		return registerOnce(
			page,
			patient,
			retryTarget.schedule,
			retryTarget.source,
		);
	}
}

async function registerOnce(
	page: PageInstance,
	patient: Patient,
	schedule: Schedule,
	source: Source,
): Promise<CreatedAppointment | null> {
	setProgress(page, "holding");
	const hold = await holdAppointment(patient, schedule, source);
	page.setData({ schedule: { ...schedule, totalFen: hold.totalFen } });
	setProgress(page, "registering");
	const appointment = await createAppointment(patient, hold);
	if (appointment.status === "duplicate") {
		page.setData({
			duplicate: {
				appointmentId: appointment.appointmentId,
				departmentName: appointment.departmentName,
				workDate: appointment.workDate,
				status: "scheduled",
			},
		});
		return null;
	}
	return appointment;
}

Page<
	PageData,
	{
		onLoad(): void;
		onShow(): void;
		bootstrap(): Promise<void>;
		loadSchedule(): Promise<void>;
		onPatientChange(event: WechatMiniprogram.PickerChange): void;
		onRegisterAndPay(event: PaymentModeEvent): void;
		onCancelAndRetry(): void;
	}
>({
	data: {
		businessType: PAY_CONFIG.businessType,
		orderType: PAY_CONFIG.orderType,
		patients: [],
		patientNames: [],
		patientIndex: -1,
		patientRelation: "",
		patientCard: "",
		targetDate: appointmentCandidateDates()[0] || "",
		schedule: null,
		source: null,
		duplicate: null,
		busy: false,
		hasPendingPayment: false,
		selectedMode: "",
		stage: "",
		message: "",
		error: "",
	} as PageData,

	onLoad() {
		void this.bootstrap();
	},

	onShow() {
		const app = getApp<{ globalData: { authCode: string } }>();
		const authCode = String(app?.globalData?.authCode || "").trim();
		const pending = readPendingPayment();
		if (!authCode && pending) {
			const pendingMode = pending.mode ?? "mixed";
			this.setData({
				hasPendingPayment: true,
				selectedMode: pendingMode,
				stage:
					pending.phase === "cash_payment"
						? "cash-confirming"
						: pending.phase === "self_payment"
							? "self-confirming"
							: pending.phase === "medical_cash_required"
								? "settling"
								: "authorizing",
				message:
					pending.phase === "cash_payment"
						? "检测到未完成的微信医保支付，请点击主按钮继续支付"
						: pending.phase === "self_payment"
							? "检测到未完成的微信自费支付，请选择自费支付继续"
							: pending.phase === "medical_cash_required"
								? "当前医保订单包含自费金额，请选择医保混合支付"
								: "检测到未完成的医保支付，请选择医保支付或医保混合支付继续授权",
				error: "",
			});
			return;
		}
		if (!authCode || !pending || resumingPayment) return;
		// 普通自费支付和医保订单进入现金待支付后，都不应消费一个
		// 可能残留的医保授权 code；否则回到页面时会错误地重新发起医保链路。
		if (pending.phase === "self_payment") {
			app.globalData.authCode = "";
			this.setData({
				hasPendingPayment: true,
				selectedMode: "self",
				stage: "self-confirming",
				error: "",
				message: "检测到未完成的微信自费支付，请选择自费支付继续",
			});
			return;
		}
		if (pending.phase === "medical_cash_required") {
			app.globalData.authCode = "";
			this.setData({
				hasPendingPayment: true,
				selectedMode: "medical",
				stage: "settling",
				error: "",
				message: "当前医保订单包含自费金额，请选择医保混合支付",
			});
			return;
		}
		app.globalData.authCode = "";
		resumingPayment = true;
		this.setData({ busy: true, duplicate: null });
		setProgress(this, "insuring", "正在调用新版医保授权接口");
		void continueMedicalPayment(authCode, pending, (stage, message) =>
			setProgress(this, stage, message),
		)
			.then(() => this.setData({ hasPendingPayment: false }))
			.catch((error: unknown) => {
				if (error instanceof WechatPaymentCancelledError) {
					showWechatPaymentCancelled(this);
					return;
				}
				if (error instanceof MedicalCashRequiredError) {
					this.setData({
						hasPendingPayment: true,
						selectedMode: "medical",
						error: "",
						message: "当前医保订单包含自费金额，请选择医保混合支付",
					});
					return;
				}
				this.setData({
					hasPendingPayment: Boolean(readPendingPayment()),
					error: friendlyError(error),
					message: "医保支付未完成，请不要重复预约",
				});
			})
			.finally(() => {
				resumingPayment = false;
				this.setData({ busy: false });
			});
	},

	async bootstrap() {
		this.setData({ busy: true, error: "" });
		try {
			await ensureSession();
			const patients = await loadPatients();
			const pending = readPendingPayment();
			const pendingIndex = pending
				? patients.findIndex((item) => item.id === pending.patientId)
				: -1;
			const defaultIndex =
				pendingIndex >= 0 ? pendingIndex : patients.length === 1 ? 0 : -1;
			const defaultPatient = patients[defaultIndex];
			this.setData({
				patients,
				patientNames: patients.map((item) => item.displayName),
				patientIndex: defaultIndex,
				hasPendingPayment: Boolean(pending),
				...(defaultPatient
					? {
							patientRelation: defaultPatient.relation || "本人",
							patientCard: mask(defaultPatient.cardNumberMasked),
						}
					: {}),
			});
			await this.loadSchedule();
		} catch (error: unknown) {
			this.setData({ error: friendlyError(error) });
		} finally {
			this.setData({ busy: false });
		}
	},

	async loadSchedule() {
		const { schedule, source } = await loadFreshRegistrationTarget(this);
		this.setData({ schedule, source, stage: "", message: "" });
	},

	onPatientChange(event: WechatMiniprogram.PickerChange) {
		if (readPendingPayment()) return;
		const index = Number(event.detail.value);
		const patient = this.data.patients[index];
		if (!patient) return;
		this.setData({
			patientIndex: index,
			patientRelation: patient.relation,
			patientCard: mask(patient.cardNumberMasked),
			duplicate: null,
			error: "",
		});
	},

	onRegisterAndPay(event: PaymentModeEvent) {
		const value = String(event.currentTarget.dataset.mode || "");
		if (value !== "medical" && value !== "mixed" && value !== "self") return;
		const mode = value as PaymentMode;
		const pending = readPendingPayment();
		if (this.data.busy) return;
		this.setData({ selectedMode: mode });
		if (pending) {
			if (pending.phase === "self_payment") {
				if (mode !== "self") {
					this.setData({
						message: "当前已有自费支付订单，请继续自费支付，不能改走医保流程",
						error: "",
					});
					return;
				}
				this.setData({ busy: true, error: "" });
				setProgress(this, "self-confirming", "请继续完成微信自费支付");
				void continueSelfPaymentFromPending(pending, (stage, message) =>
					setProgress(this, stage, message),
				)
					.then(() => this.setData({ hasPendingPayment: false }))
					.catch((error: unknown) => {
						if (error instanceof WechatPaymentCancelledError) {
							showWechatPaymentCancelled(this);
							return;
						}
						this.setData({
							error: friendlyError(error),
							message: "微信自费支付未完成，请不要重复预约",
						});
					})
					.finally(() => this.setData({ busy: false }));
				return;
			}
			if (
				pending.phase === "cash_payment" ||
				pending.phase === "medical_cash_required"
			) {
				if (mode !== "mixed") {
					this.setData({
						message: "当前医保订单包含自费金额，请选择医保混合支付",
						error: "",
					});
					return;
				}
				this.setData({ busy: true, error: "" });
				const mixedPending = {
					...pending,
					mode: "mixed" as const,
					phase: "cash_payment" as const,
				};
				setProgress(this, "cash-confirming", "请继续完成微信医保混合支付");
				void continueMedicalCashPayment(mixedPending, (stage, message) =>
					setProgress(this, stage, message),
				)
					.then(() => this.setData({ hasPendingPayment: false }))
					.catch((error: unknown) => {
						if (error instanceof WechatPaymentCancelledError) {
							showWechatPaymentCancelled(this);
							return;
						}
						this.setData({
							error: friendlyError(error),
							message: "微信医保混合支付未完成，请不要重复预约",
						});
					})
					.finally(() => this.setData({ busy: false }));
				return;
			}
			if (mode === "self") {
				this.setData({
					message:
						"当前预约已经进入医保流程，不能切换为自费支付；请先取消预约后重新选择",
					error: "",
				});
				return;
			}
			this.setData({ busy: true, error: "" });
			setPendingPaymentMode(pending, mode);
			setProgress(this, "authorizing", "请在医保小程序继续完成授权");
			void navigateToMedicalAuth()
				.catch((error: unknown) => {
					if (error instanceof MedicalAuthNavigationCancelledError) {
						showNavigationCancelled(this);
						return;
					}
					this.setData({
						error: friendlyError(error),
						message: "医保授权未完成",
					});
				})
				.finally(() => this.setData({ busy: false }));
			return;
		}
		const patient = this.data.patients[this.data.patientIndex];
		if (!patient) return;
		this.setData({ busy: true, duplicate: null, error: "" });
		void registerWithFreshTarget(this, patient)
			.then(async (appointment) => {
				if (!appointment) {
					this.setData({ busy: false, message: "检测到已有预约，未重复挂号" });
					return;
				}
				if (mode === "self") {
					this.setData({ message: "预约已写入，正在进入自费支付" });
					await startSelfPayment(appointment, (stage, message) =>
						setProgress(this, stage, message),
					);
					return;
				}
				this.setData({
					message:
						mode === "medical"
							? "预约已写入，正在进入医保支付"
							: "预约已写入，正在进入医保混合支付",
				});
				await startMedicalPayment(
					appointment,
					(stage, message) => setProgress(this, stage, message),
					mode,
				);
			})
			.catch((error: unknown) => {
				if (error instanceof MedicalAuthNavigationCancelledError) {
					showNavigationCancelled(this);
					return;
				}
				if (error instanceof WechatPaymentCancelledError) {
					showWechatPaymentCancelled(this);
					return;
				}
				if (error instanceof MedicalCashRequiredError) {
					this.setData({
						hasPendingPayment: true,
						selectedMode: "medical",
						error: "",
						message: "当前医保订单包含自费金额，请选择医保混合支付",
					});
					return;
				}
				this.setData({
					error: friendlyError(error),
					message: mode === "self" ? "自费支付未完成" : "医保支付流程未完成",
				});
			})
			.finally(() => {
				if (!this.data.duplicate) this.setData({ busy: false });
			});
	},

	onCancelAndRetry() {
		const patient = this.data.patients[this.data.patientIndex];
		const record = this.data.duplicate;
		const mode: PaymentMode = this.data.selectedMode || "mixed";
		if (!patient || !record || this.data.busy) return;
		wx.showModal({
			title: "确认取消并重挂？",
			content:
				mode === "self"
					? "将先调用取消预约接口，取消成功后再重新占号、写入预约并发起自费支付。"
					: mode === "medical"
						? "将先调用取消预约接口，取消成功后再重新占号、写入预约并发起医保支付。"
						: "将先调用取消预约接口，取消成功后再重新占号、写入预约并发起医保混合支付。",
			confirmText: "确认继续",
			success: (result) => {
				if (!result.confirm) return;
				// 取消成功前保留重复预约卡片，取消接口失败时用户仍能看到
				// 原预约并可再次处理，不能把失败误显示成“没有重复预约”。
				this.setData({ busy: true, error: "" });
				void cancelAppointment(record.appointmentId)
					.then(() => {
						this.setData({ duplicate: null });
						return registerWithFreshTarget(this, patient);
					})
					.then(async (appointment) => {
						if (!appointment) {
							this.setData({ message: "取消成功，但仍存在有效预约" });
							return;
						}
						if (mode === "self") {
							await startSelfPayment(appointment, (stage, message) =>
								setProgress(this, stage, message),
							);
							return;
						}
						await startMedicalPayment(
							appointment,
							(stage, message) => setProgress(this, stage, message),
							mode,
						);
					})
					.catch((error: unknown) => {
						if (error instanceof MedicalAuthNavigationCancelledError) {
							showNavigationCancelled(this);
							return;
						}
						this.setData({
							error: friendlyError(error),
							message: "取消或重新预约未完成",
						});
					})
					.finally(() => this.setData({ busy: false }));
			},
		});
	},
});
