import { ApiError, getCurrentUser } from "../../services/api-client";
import { loadPatients } from "../../services/dashboard-service";
import {
	getSelectedPatientId,
	setSelectedPatientId,
} from "../../services/patient-selection-service";
import type { ActionEvent, MyPageData } from "../../types";

type MyPageMethods = {
	loadPage(): Promise<void>;
	onHeaderTap(): void;
	onAction(event: ActionEvent): void;
	onTabTap(event: WechatMiniprogram.TouchEvent): void;
	onPullDownRefresh(): void;
	showError(error: unknown, fallback: string): void;
};

Page<MyPageData, MyPageMethods>({
	data: {
		userLabel: "微信用户",
		selectedPatient: null,
		patientCount: 0,
		loading: true,
		error: "",
	},

	onLoad() {
		this.loadPage();
	},

	/** 页面恢复时重新读取患者数量和当前选择，避免与患者选择页脱节。 */
	onShow() {
		if (!this.data.loading) this.loadPage();
	},

	loadPage(): Promise<void> {
		this.setData({ loading: true, error: "" });
		return Promise.all([getCurrentUser(), loadPatients()])
			.then(([userPayload, patients]) => {
				const selectedId = getSelectedPatientId();
				const selectedPatient =
					patients.find((patient) => patient.id === selectedId) ??
					patients[0] ??
					null;
				if (selectedPatient && selectedPatient.id !== selectedId) {
					setSelectedPatientId(selectedPatient.id);
				}
				this.setData({
					userLabel: userPayload.data.user.id ? "微信用户" : "未登录",
					selectedPatient,
					patientCount: patients.length,
					error: "",
				});
			})
			.catch((error) => this.showError(error, "我的页面加载失败"))
			.finally(() => this.setData({ loading: false }));
	},

	onHeaderTap(): void {
		wx.navigateTo({ url: "/pages/patient-select/patient-select" });
	},

	onAction(event): void {
		const action = event.currentTarget?.dataset?.action;
		switch (action) {
			case "patient-select":
				wx.navigateTo({ url: "/pages/patient-select/patient-select" });
				break;
			case "appointment-records":
				wx.navigateTo({
					url: "/pages/appointment-records/appointment-records",
				});
				break;
			case "outpatient-payment":
				wx.navigateTo({ url: "/pages/outpatient-payment/outpatient-payment" });
				break;
			default:
				wx.showToast({ title: "该服务正在迁移中", icon: "none" });
		}
	},

	onTabTap(event): void {
		const index = Number(event.currentTarget?.dataset?.index);
		if (index === 0) {
			wx.reLaunch({ url: "/pages/index/index" });
			return;
		}
		if (index === 3) return;
		wx.showToast({ title: "该页面正在迁移中", icon: "none" });
	},

	onPullDownRefresh(): void {
		this.loadPage().finally(() => wx.stopPullDownRefresh());
	},

	showError(error: unknown, fallback: string): void {
		this.setData({
			error: error instanceof ApiError ? error.message : fallback,
		});
	},
});
