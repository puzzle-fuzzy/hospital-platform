import {
	amountYuan,
	loadRecordDetail,
	type OutpatientRecord,
} from "../../services/outpatient";
import { loadPatients, type Patient } from "../../services/patient";
import { ApiError } from "../../services/request";
import { ensureSession } from "../../services/session";

type PageData = {
	patient: Patient | null;
	item: OutpatientRecord | null;
	loading: boolean;
	error: string;
	patientId: string;
	recordId: string;
	status: "unpaid" | "paid" | "";
};

function validReference(value: unknown): value is string {
	return (
		typeof value === "string" &&
		value.length > 0 &&
		value.length <= 128 &&
		value === value.trim()
	);
}

function friendlyError(error: unknown): string {
	const message =
		error instanceof ApiError
			? error.message
			: error instanceof Error
				? error.message
				: "门诊费用详情加载失败，请稍后重试";
	return message.length > 80 ? `${message.slice(0, 80)}…` : message;
}

Page<
	PageData,
	{
		onLoad(options: Record<string, string | undefined>): void;
		loadDetail(): Promise<void>;
		onRetry(): void;
		onBack(): void;
		formatAmount(amountFen: number): string;
		formatDate(value: string): string;
		statusLabel(status: "unpaid" | "paid"): string;
	}
>({
	data: {
		patient: null,
		item: null,
		loading: true,
		error: "",
		patientId: "",
		recordId: "",
		status: "",
	},

	onLoad(options) {
		const patientId = options?.patientId;
		const recordId = options?.recordId;
		const status = options?.status;
		if (
			!validReference(patientId) ||
			!validReference(recordId) ||
			(status !== "unpaid" && status !== "paid")
		) {
			this.setData({
				loading: false,
				error: "门诊费用详情引用无效，请返回费用记录重新进入",
			});
			return;
		}
		this.setData({ patientId, recordId, status });
		void this.loadDetail();
	},

	async loadDetail() {
		const { patientId, recordId, status } = this.data;
		if (!patientId || !recordId || !status) return;
		this.setData({ loading: true, error: "", item: null });
		try {
			await ensureSession();
			const patients = await loadPatients();
			const patient = patients.find((entry) => entry.id === patientId);
			if (!patient) throw new Error("当前就诊人不可用，请返回重新选择");
			const detail = await loadRecordDetail(patientId, recordId, status);
			this.setData({ patient, item: detail.item });
		} catch (error) {
			this.setData({ patient: null, item: null, error: friendlyError(error) });
		} finally {
			this.setData({ loading: false });
		}
	},

	onRetry() {
		if (!this.data.loading) void this.loadDetail();
	},

	onBack() {
		wx.navigateBack({ delta: 1 });
	},

	formatAmount(amountFen) {
		return amountYuan(amountFen);
	},

	formatDate(value) {
		return value.slice(0, 10);
	},

	statusLabel(status) {
		return status === "paid" ? "已缴费" : "待缴费";
	},
});
