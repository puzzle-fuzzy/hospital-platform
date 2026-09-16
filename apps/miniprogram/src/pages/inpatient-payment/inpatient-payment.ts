import { ApiError } from "../../services/api-client";
import { loadCurrentPatient } from "../../services/dashboard-service";
import { navigateToPatientSelector } from "../../services/patient-navigation";
import type { Patient } from "../../types";

type InpatientPaymentPageData = {
	patient: Patient | null;
	patientName: string;
	mobile: string;
	loading: boolean;
	querying: boolean;
	message: string;
	messageKind: "error" | "info" | "success" | "";
};

type InpatientPaymentPageMethods = {
	loadPatient(): Promise<void>;
	onPatientInput(event: WechatMiniprogram.Input): void;
	onMobileInput(event: WechatMiniprogram.Input): void;
	onChangePatient(): void;
	onQuery(): void;
	onRetry(): void;
	onBackHome(): void;
};

function messageFromError(error: unknown): string {
	if (error instanceof ApiError && error.code === "patient-selection-required") {
		return "请先选择住院就诊人";
	}
	return "就诊人信息暂时无法获取，请稍后重试";
}

/**
 * 旧端 inpatient_payment.vue 是一个“姓名 + 手机号 + 查询”的预交金入口，
 * 不是详情或支付完成页。这里先完整迁移表单和患者选择交互；费用查询、
 * 支付和 HIS 回写不在客户端伪造，待住院支付 contract 接入后替换查询分支。
 */
Page<InpatientPaymentPageData, InpatientPaymentPageMethods>({
	data: {
		patient: null,
		patientName: "",
		mobile: "",
		loading: true,
		querying: false,
		message: "",
		messageKind: "",
	},

	onLoad() {
		wx.setNavigationBarTitle({ title: "住院预缴" });
		void this.loadPatient();
	},

	onShow() {
		if (!this.data.loading) void this.loadPatient();
	},

	loadPatient() {
		this.setData({ loading: true, message: "", messageKind: "" });
		return loadCurrentPatient()
			.then((patient) => {
				this.setData({
					patient,
					patientName: patient.displayName,
					loading: false,
				});
			})
			.catch((error: unknown) => {
				this.setData({
					patient: null,
					loading: false,
					message: messageFromError(error),
					messageKind: "error",
				});
			});
	},

	onPatientInput(event) {
		this.setData({ patientName: String(event.detail.value ?? "") });
	},

	onMobileInput(event) {
		this.setData({ mobile: String(event.detail.value ?? "") });
	},

	onChangePatient() {
		navigateToPatientSelector("valid");
	},

	onQuery() {
		const name = this.data.patientName.trim();
		const mobile = this.data.mobile.trim();
		if (!name) {
			this.setData({ message: "请输入就诊人姓名", messageKind: "error" });
			return;
		}
		if (!/^1\d{10}$/.test(mobile)) {
			this.setData({ message: "请输入正确的手机号", messageKind: "error" });
			return;
		}
		if (this.data.querying) return;
		// 旧端此处也只有 TODO 查询；保留用户动作反馈，但不把未接入的
		// 费用结果伪装成成功，更不会直接调起微信支付。
		this.setData({
			querying: false,
			message: "住院费用查询接口正在接入中，本次未发起支付。",
			messageKind: "info",
		});
	},

	onRetry() {
		if (!this.data.loading) void this.loadPatient();
	},

	onBackHome() {
		wx.switchTab({ url: "/pages/index/index" });
	},
});
