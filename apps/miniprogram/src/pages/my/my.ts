import { getCurrentUser, safeApiErrorMessage } from "../../services/api-client";
import { loadPatients } from "../../services/dashboard-service";
import { resolveStoredPatientSelection } from "../../services/patient-selection-service";
import { getPageLatestRequestGuard } from "../../services/page-instance-state";
import type { ActionEvent, MyPageData } from "../../types";

type MyPageMethods = {
	loadPage(): Promise<void>;
	onHeaderTap(): void;
	onFamilyTap(): void;
	onAction(event: ActionEvent): void;
	onTabTap(event: WechatMiniprogram.TouchEvent): void;
	onPullDownRefresh(): void;
	showError(error: unknown, fallback: string): void;
};

/**
 * 个人中心中仍保留旧端入口的可见性，但这些能力没有完成独立 contract。
 * 文案必须按能力说明关闭原因，不能用统一的“点击了某某”或伪造成功，
 * 更不能在这里绕过平台 API 直连旧 WebView、医生关系接口或医保小程序。
 */
const MY_UNAVAILABLE_ACTION_MESSAGES = Object.freeze({
	consultation: "我的问诊功能正在迁移中",
	doctor: "我的医生功能正在迁移中",
	"electronic-consultation": "电子导诊单功能正在迁移中",
	insurance: "医保电子凭证需要独立授权，当前暂未开放",
	"smart-customer": "智能客服功能正在迁移中",
} as const);

type UnavailableMyAction = keyof typeof MY_UNAVAILABLE_ACTION_MESSAGES;

function showUnavailableMyAction(action: UnavailableMyAction): void {
	wx.showToast({
		title: MY_UNAVAILABLE_ACTION_MESSAGES[action],
		icon: "none",
	});
}

/**
 * “我的”页同时读取会话用户和患者目录；从选择页返回或下拉刷新时，
 * 较早的 Promise.all 不能再覆盖当前用户和就诊人数量。
 */
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
		const pageLoadGuard = getPageLatestRequestGuard(this, "my-page");
		const requestToken = pageLoadGuard.begin();
		this.setData({ loading: true, error: "" });
		return Promise.all([getCurrentUser(), loadPatients()])
			.then(([userPayload, patients]) => {
				if (!pageLoadGuard.isCurrent(requestToken)) return;
				const resolution = resolveStoredPatientSelection(patients);
				const selectedPatient = resolution.patient ?? null;
				this.setData({
					userLabel: userPayload.data.user.id ? "微信用户" : "未登录",
					selectedPatient,
					patientCount: patients.length,
					error:
						resolution.state === "stale"
							? "上次选择的就诊人已不可用，请重新选择就诊人"
							: "",
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
		wx.navigateTo({ url: "/pages/profile/profile" });
	},

	onFamilyTap(): void {
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
			case "electronic-consultation":
				showUnavailableMyAction("electronic-consultation");
				break;
			case "consultation":
				showUnavailableMyAction("consultation");
				break;
			case "doctor":
				showUnavailableMyAction("doctor");
				break;
			case "smart-customer":
				showUnavailableMyAction("smart-customer");
				break;
			case "insurance":
				showUnavailableMyAction("insurance");
				break;
			case "feedback":
				// 旧端反馈页目前也是静态问答和客服电话，在线反馈提交仍未开放。
				wx.navigateTo({ url: "/pages/feedback/feedback" });
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
		this.setData({ error: safeApiErrorMessage(error, fallback) });
	},
});
