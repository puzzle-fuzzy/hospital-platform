import { ApiError, getCurrentUser } from "../../services/api-client";
import { loadPatients } from "../../services/dashboard-service";
import {
	getSelectedPatientId,
	setSelectedPatientId,
} from "../../services/patient-selection-service";
import { createLatestRequestGuard } from "../../services/latest-request-guard";
import type { ActionEvent, MyPageData } from "../../types";

type MyPageMethods = {
	loadPage(): Promise<void>;
	onHeaderTap(): void;
	onAction(event: ActionEvent): void;
	onTabTap(event: WechatMiniprogram.TouchEvent): void;
	onPullDownRefresh(): void;
	showError(error: unknown, fallback: string): void;
};

/**
 * “我的”页同时读取会话用户和患者目录；从选择页返回或下拉刷新时，
 * 较早的 Promise.all 不能再覆盖当前用户和就诊人数量。
 */
const pageLoadGuard = createLatestRequestGuard();

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
		const requestToken = pageLoadGuard.begin();
		this.setData({ loading: true, error: "" });
		return Promise.all([getCurrentUser(), loadPatients()])
			.then(([userPayload, patients]) => {
				if (!pageLoadGuard.isCurrent(requestToken)) return;
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
			.catch((error) => {
				if (pageLoadGuard.isCurrent(requestToken)) {
					this.showError(error, "我的页面加载失败");
				}
			})
			.finally(() => {
				if (pageLoadGuard.isCurrent(requestToken)) {
					this.setData({ loading: false });
				}
			});
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
			case "missed-appointments":
				wx.navigateTo({
					url: "/pages/missed-appointments/missed-appointments",
				});
				break;
			case "outpatient-payment":
				wx.navigateTo({ url: "/pages/outpatient-payment/outpatient-payment" });
				break;
			case "medical-record":
				// 报告目录与门诊病历是两类不同医疗事实，不能复用 reports 路由。
				wx.showToast({ title: "门诊病历正在迁移中", icon: "none" });
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
