import { PAY_CONFIG } from "../../config";
import {
	type AppointmentRecord,
	loadSources,
	loadTargetSchedule,
	type Schedule,
	type Source,
	selectSource,
} from "../../services/appointment";
import {
	continueMedicalPayment,
	navigateToMedicalAuth,
	readPendingPayment,
} from "../../services/medical-insurance";
import { loadPatients, mask, type Patient } from "../../services/patient";
import {
	cancelAndRetry,
	type QuickProgress,
	runQuickRegistration,
} from "../../services/quick-registration";
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

let resumingPayment = false;

const progressText: Record<QuickProgress, string> = {
	checking: "正在检查预约状态",
	"reading-source": "正在读取号源",
	registering: "正在预约指定号源",
	settling: "正在创建医保结算订单",
	paying: "正在发起医保支付",
	authorizing: "请在医保小程序完成授权",
	insuring: "正在核验医保信息",
	polling: "正在确认医保结算结果",
	"wechat-paying": "请完成微信自费支付",
	success: "挂号和医保支付成功",
};

function friendlyError(error: unknown): string {
	const message =
		error instanceof Error
			? error.message
			: "请求失败，请查看开发者工具网络日志";
	return message.length > 80 ? `${message.slice(0, 80)}…` : message;
}

type PageInstance = { setData(data: Partial<PageData>): void };

type IndexPageMethods = {
	bootstrap(): Promise<void>;
	loadSchedule(): Promise<void>;
	onPatientChange(event: WechatMiniprogram.PickerChange): void;
	onQuickRegister(): void;
	onCancelAndRetry(): void;
};

function setProgress(
	page: PageInstance,
	stage: QuickProgress,
	message?: string,
): void {
	page.setData({ stage, message: message || progressText[stage], error: "" });
}

Page<PageData, IndexPageMethods>({
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
		setProgress(this, "insuring", "正在继续医保支付");
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
				? patients.findIndex((item) => item.patId === pending.patId)
				: -1;
			const defaultIndex =
				pendingIndex >= 0 ? pendingIndex : patients.length === 1 ? 0 : -1;
			const defaultPatient = patients[defaultIndex];
			this.setData({
				patients,
				patientNames: patients.map((item) => item.name),
				patientIndex: defaultIndex,
				hasPendingPayment: Boolean(pending),
				...(defaultPatient
					? {
							patientRelation: defaultPatient.relation || "本人",
							patientCard: mask(defaultPatient.cardNo || ""),
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
		// 首屏不分叉：预约编排服务在这里加载目标排班和第一个可用号源。
		const schedule = await loadTargetSchedule();
		const source = selectSource(await loadSources(schedule));
		this.setData({ schedule, source });
	},

	onPatientChange(event: WechatMiniprogram.PickerChange) {
		if (readPendingPayment()) return;
		const index = Number(event.detail.value);
		const patient = this.data.patients[index];
		if (!patient) return;
		this.setData({
			patientIndex: index,
			patientRelation: patient.relation,
			patientCard: mask(patient.cardNo),
			duplicate: null,
			error: "",
		});
	},

	onQuickRegister() {
		const patient = this.data.patients[this.data.patientIndex];
		if (!patient || this.data.busy) return;
		const pending = readPendingPayment();
		if (pending) {
			this.setData({ busy: true, duplicate: null, error: "" });
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
		if (!this.data.source) return;
		this.setData({ busy: true, duplicate: null, error: "" });
		void runQuickRegistration(patient, (stage, message) =>
			setProgress(this, stage, message),
		)
			.then((result) => {
				if (result.kind === "duplicate") {
					this.setData({
						duplicate: result.record,
						schedule: result.schedule,
						source: result.source,
						busy: false,
						message: "检测到已有预约，未重复挂号",
					});
					return;
				}
				this.setData({
					schedule: result.schedule,
					source: result.source,
					message: "已创建预约，正在进入医保支付",
				});
			})
			.catch((error: unknown) =>
				this.setData({
					error: friendlyError(error),
					busy: false,
					message: "流程未完成",
				}),
			)
			.finally(() => {
				if (!this.data.duplicate) this.setData({ busy: false });
			});
	},

	onCancelAndRetry() {
		const patient = this.data.patients[this.data.patientIndex];
		const record = this.data.duplicate;
		if (!patient || !record || this.data.busy) return;
		wx.showModal({
			title: "确认取消并重挂？",
			content: "原预约取消成功后，才会重新预约同一门诊并发起医保支付。",
			confirmText: "确认继续",
			success: (result) => {
				if (!result.confirm) return;
				this.setData({ busy: true, duplicate: null, error: "" });
				void cancelAndRetry(patient, record, (stage, message) =>
					setProgress(this, stage, message),
				)
					.then((next) => {
						if (next.kind === "duplicate")
							this.setData({
								duplicate: next.record,
								message: "原预约已处理，但仍检测到有效预约",
							});
						else
							this.setData({
								schedule: next.schedule,
								source: next.source,
								message: "已创建预约，正在进入医保支付",
							});
					})
					.catch((error: unknown) =>
						this.setData({
							error: friendlyError(error),
							message: "取消或重挂未完成",
						}),
					)
					.finally(() => this.setData({ busy: false }));
			},
		});
	},
});
