import { ApiError } from "../../services/api-client";
import {
	loadOutpatientPaymentRecords,
	loadPatients,
} from "../../services/dashboard-service";
import {
	getSelectedPatientId,
	setSelectedPatientId,
} from "../../services/patient-selection-service";
import type {
	OutpatientPaymentPageData,
	OutpatientPaymentRecord,
	OutpatientPaymentRecordView,
	Patient,
} from "../../types";

type OutpatientPaymentPageMethods = {
	loadPage(): Promise<void>;
	loadRecords(patient: Patient): Promise<void>;
	onStatusTap(event: WechatMiniprogram.TouchEvent): void;
	onChangePatient(): void;
	onRecordTap(): void;
	onPullDownRefresh(): void;
	showError(error: unknown, fallback: string): void;
	toView(record: OutpatientPaymentRecord): OutpatientPaymentRecordView;
};

let isFirstShow = true;

Page<OutpatientPaymentPageData, OutpatientPaymentPageMethods>({
	data: {
		selectedPatient: null,
		activeStatus: "unpaid",
		items: [],
		loading: true,
		error: "",
	},

	onLoad() {
		isFirstShow = true;
		this.loadPage();
	},

	onShow() {
		if (isFirstShow) {
			isFirstShow = false;
			return;
		}
		this.loadPage();
	},

	/** 先确认当前患者归属，再读取门诊费用，避免把 provider patId 交给页面。 */
	loadPage(): Promise<void> {
		this.setData({ loading: true, error: "" });
		return loadPatients()
			.then((patients) => {
				const selectedId = getSelectedPatientId();
				const patient =
					patients.find((item) => item.id === selectedId) ?? patients[0];
				if (!patient) {
					throw new ApiError("请先登录并选择就诊人", {
						code: "patient-selection-required",
					});
				}
				setSelectedPatientId(patient.id);
				this.setData({ selectedPatient: patient });
				return this.loadRecords(patient);
			})
			.catch((error) => this.showError(error, "门诊缴费记录加载失败"))
			.finally(() => this.setData({ loading: false }));
	},

	loadRecords(patient: Patient): Promise<void> {
		return loadOutpatientPaymentRecords(
			patient.id,
			this.data.activeStatus,
		).then((items) =>
			this.setData({
				items: items.map((item) => this.toView(item)),
				error: "",
			}),
		);
	},

	/** 切换待缴费/已缴费时只请求当前患者和当前状态。 */
	onStatusTap(event): void {
		const status = event.currentTarget?.dataset?.status;
		if (status !== "unpaid" && status !== "paid") return;
		if (status === this.data.activeStatus) return;
		this.setData({ activeStatus: status, loading: true, error: "", items: [] });
		if (!this.data.selectedPatient) {
			this.setData({ loading: false });
			return;
		}
		this.loadRecords(this.data.selectedPatient).finally(() =>
			this.setData({ loading: false }),
		);
	},

	onChangePatient(): void {
		wx.navigateTo({ url: "/pages/patient-select/patient-select" });
	},

	/** 只读阶段不伪造支付调起；真正支付接入医保/微信订单后再开放。 */
	onRecordTap(): void {
		wx.showToast({ title: "支付流程正在迁移中", icon: "none" });
	},

	toView(record): OutpatientPaymentRecordView {
		return {
			...record,
			amountLabel: `¥${(record.amountFen / 100).toFixed(2)}`,
		};
	},

	onPullDownRefresh(): void {
		this.loadPage().finally(() => wx.stopPullDownRefresh());
	},

	showError(error: unknown, fallback: string): void {
		let message = fallback;
		if (error instanceof ApiError) {
			if (error.code === "dependency-not-configured") {
				message = "门诊缴费服务暂未配置完成，请联系管理员";
			} else if (error.code === "patient-selection-required") {
				message = "请先选择就诊人，再查看门诊缴费记录";
			} else if (error.code === "outpatient-payment-patient-not-found") {
				message = "当前就诊人暂未建立门诊缴费映射";
			} else {
				message = error.message;
			}
		}
		this.setData({ error: message, items: [] });
	},
});
