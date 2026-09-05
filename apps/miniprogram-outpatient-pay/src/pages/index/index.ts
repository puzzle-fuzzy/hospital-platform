import { OUTPATIENT_PAY_CONFIG } from "../../config";
import {
	amountYuan,
	loadUnpaidRecords,
	type OutpatientRecord,
} from "../../services/outpatient";
import { loadPatients, type Patient } from "../../services/patient";
import { ApiError } from "../../services/request";
import { ensureSession } from "../../services/session";

type PageData = {
	businessType: string;
	orderType: string;
	patients: Patient[];
	patientNames: string[];
	patientIndex: number;
	selectedPatient: Patient | null;
	records: OutpatientRecord[];
	busy: boolean;
	message: string;
	error: string;
};

function friendlyError(error: unknown): string {
	const message =
		error instanceof ApiError
			? error.message
			: error instanceof Error
				? error.message
				: "请求失败，请稍后重试";
	return message.length > 80 ? `${message.slice(0, 80)}…` : message;
}

Page<
	PageData,
	{
		onLoad(): void;
		onPatientChange(event: WechatMiniprogram.PickerChange): void;
		bootstrap(): Promise<void>;
		loadRecords(): Promise<void>;
		formatAmount(amountFen: number): string;
		formatPaymentType(): string;
		onRecordTap(event: WechatMiniprogram.TouchEvent): void;
	}
>({
	data: {
		businessType: OUTPATIENT_PAY_CONFIG.businessType,
		orderType: OUTPATIENT_PAY_CONFIG.orderType,
		patients: [],
		patientNames: [],
		patientIndex: -1,
		selectedPatient: null,
		records: [],
		busy: false,
		message: "",
		error: "",
	} as PageData,

	onLoad() {
		void this.bootstrap();
	},

	async bootstrap() {
		this.setData({ busy: true, error: "", message: "正在加载就诊人" });
		try {
			await ensureSession();
			const patients = await loadPatients();
			this.setData({
				patients,
				patientNames: patients.map((patient) => patient.displayName),
				patientIndex: 0,
				selectedPatient: patients[0] ?? null,
				message: "",
			});
			await this.loadRecords();
		} catch (error) {
			this.setData({ error: friendlyError(error), message: "" });
		} finally {
			this.setData({ busy: false });
		}
	},

	onPatientChange(event) {
		const index = Number(event.detail.value);
		const patient = this.data.patients[index];
		if (!patient) return;
		this.setData({ patientIndex: index, selectedPatient: patient });
		void this.loadRecords();
	},

	async loadRecords() {
		const patient = this.data.selectedPatient;
		if (!patient) return;
		this.setData({ busy: true, error: "", message: "正在读取待缴费项目" });
		try {
			const records = await loadUnpaidRecords(patient.id);
			this.setData({
				records,
				message: records.length ? "" : "当前就诊人暂无待缴费用",
			});
		} catch (error) {
			this.setData({ records: [], error: friendlyError(error), message: "" });
		} finally {
			this.setData({ busy: false });
		}
	},

	formatAmount(amountFen: number): string {
		return amountYuan(amountFen);
	},

	formatPaymentType(): string {
		return "医保支付 / 医保混合支付 / 自费支付";
	},

	onRecordTap(event) {
		const recordId = String(
			event.currentTarget?.dataset?.recordId || "",
		).trim();
		const status = event.currentTarget?.dataset?.status;
		const patientId = this.data.selectedPatient?.id;
		if (!patientId || !recordId || (status !== "unpaid" && status !== "paid"))
			return;
		wx.navigateTo({
			url: `/pages/detail/detail?patientId=${encodeURIComponent(patientId)}&recordId=${encodeURIComponent(recordId)}&status=${encodeURIComponent(status)}`,
		});
	},
});
