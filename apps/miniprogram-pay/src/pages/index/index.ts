import { PAY_CONFIG } from "../../config";
import {
	cancelAppointment,
	createAppointment,
	holdAppointment,
	loadSources,
	loadTargetSchedule,
	selectSource,
	type AppointmentRecord,
	type CreatedAppointment,
	type Schedule,
	type Source,
} from "../../services/appointment";
import {
	continueMedicalPayment,
	navigateToMedicalAuth,
	readPendingPayment,
	startMedicalPayment,
	type PaymentProgress,
} from "../../services/medical-insurance";
import { loadPatients, mask, type Patient } from "../../services/patient";
import { ensureSession } from "../../services/session";

type PageData = {
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
	success: "挂号和医保支付成功",
};

function friendlyError(error: unknown): string {
	const message =
		error instanceof Error ? error.message : "请求失败，请查看开发者工具日志";
	return message.length > 80 ? `${message.slice(0, 80)}…` : message;
}

type PageInstance = { setData(data: Partial<PageData>): void; data: PageData };

function setProgress(
	page: PageInstance,
	stage: RegistrationProgress,
	message?: string,
): void {
	page.setData({ stage, message: message || progressText[stage], error: "" });
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
		onRegisterAndPay(): void;
		onCancelAndRetry(): void;
	}
>({
	data: {
		patients: [],
		patientNames: [],
		patientIndex: -1,
		patientRelation: "",
		patientCard: "",
		targetDate: PAY_CONFIG.targetDate,
		schedule: null,
		source: null,
		duplicate: null,
		busy: false,
		hasPendingPayment: false,
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
			this.setData({
				hasPendingPayment: true,
				stage: "authorizing",
				message: "检测到未完成的医保支付，请点击主按钮继续授权",
				error: "",
			});
			return;
		}
		if (!authCode || !pending || resumingPayment) return;
		app.globalData.authCode = "";
		resumingPayment = true;
		this.setData({ busy: true, duplicate: null });
		setProgress(this, "insuring", "正在调用新版医保授权接口");
		void continueMedicalPayment(authCode, pending, (stage, message) =>
			setProgress(this, stage, message),
		)
			.then(() => this.setData({ hasPendingPayment: false }))
			.catch((error: unknown) =>
				this.setData({
					hasPendingPayment: Boolean(readPendingPayment()),
					error: friendlyError(error),
					message: "医保支付未完成，请不要重复预约",
				}),
			)
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
		setProgress(this, "loading-source", "正在读取新版预约目录");
		const schedule = await loadTargetSchedule();
		const source = selectSource(await loadSources(schedule));
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

	onRegisterAndPay() {
		const pending = readPendingPayment();
		if (this.data.busy) return;
		if (pending) {
			this.setData({ busy: true, error: "" });
			setProgress(this, "authorizing", "请在医保小程序继续完成授权");
			void navigateToMedicalAuth()
				.catch((error: unknown) =>
					this.setData({
						error: friendlyError(error),
						message: "医保授权未完成",
					}),
				)
				.finally(() => this.setData({ busy: false }));
			return;
		}
		const patient = this.data.patients[this.data.patientIndex];
		if (!patient) return;
		const { schedule, source } = this.data;
		if (!schedule || !source) return;
		this.setData({ busy: true, duplicate: null, error: "" });
		void registerOnce(this, patient, schedule, source)
			.then(async (appointment) => {
				if (!appointment) {
					this.setData({ busy: false, message: "检测到已有预约，未重复挂号" });
					return;
				}
				this.setData({ message: "预约已写入，正在进入医保授权" });
				await startMedicalPayment(appointment, (stage, message) =>
					setProgress(this, stage, message),
				);
			})
			.catch((error: unknown) =>
				this.setData({ error: friendlyError(error), message: "流程未完成" }),
			)
			.finally(() => {
				if (!this.data.duplicate) this.setData({ busy: false });
			});
	},

	onCancelAndRetry() {
		const patient = this.data.patients[this.data.patientIndex];
		const record = this.data.duplicate;
		const { schedule, source } = this.data;
		if (!patient || !record || !schedule || !source || this.data.busy) return;
		wx.showModal({
			title: "确认取消并重挂？",
			content:
				"将先调用取消预约接口，取消成功后再重新占号、写入预约并发起医保授权。",
			confirmText: "确认继续",
			success: (result) => {
				if (!result.confirm) return;
				// 取消成功前保留重复预约卡片，取消接口失败时用户仍能看到
				// 原预约并可再次处理，不能把失败误显示成“没有重复预约”。
				this.setData({ busy: true, error: "" });
				void cancelAppointment(record.appointmentId)
					.then(() => {
						this.setData({ duplicate: null });
						return registerOnce(this, patient, schedule, source);
					})
					.then(async (appointment) => {
						if (!appointment) {
							this.setData({ message: "取消成功，但仍存在有效预约" });
							return;
						}
						await startMedicalPayment(appointment, (stage, message) =>
							setProgress(this, stage, message),
						);
					})
					.catch((error: unknown) =>
						this.setData({
							error: friendlyError(error),
							message: "取消或重新预约未完成",
						}),
					)
					.finally(() => this.setData({ busy: false }));
			},
		});
	},
});
