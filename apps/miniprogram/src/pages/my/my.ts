import {
	getCurrentUser,
	getUserProfile,
	safeApiErrorMessage,
} from "../../services/api-client";
import { loadPatients } from "../../services/dashboard-service";
import { resolveStoredPatientSelection } from "../../services/patient-selection-service";
import { navigateToPatientSelector } from "../../services/patient-navigation";
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
		// `/me` 和患者目录决定“我的”页的核心会话上下文，资料只是头像区域的
		// 展示增强。资料读取失败不能让已经成功的患者上下文整页失败，但必须
		// 留下用户可见的可重试提示，避免把“微信用户”误认为资料读取成功。
		const profileResult = getUserProfile().then(
			(response) => ({ status: "fulfilled" as const, response }),
			(error) => ({ status: "rejected" as const, error }),
		);
		return Promise.all([getCurrentUser(), loadPatients(), profileResult])
			.then(([userPayload, patients, profile]) => {
				if (!pageLoadGuard.isCurrent(requestToken)) return;
				const resolution = resolveStoredPatientSelection(patients);
				const selectedPatient = resolution.patient ?? null;
				const displayName =
					profile.status === "fulfilled"
						? profile.response.data.displayName.trim()
						: "";
				const profileError =
					profile.status === "rejected"
						? safeApiErrorMessage(profile.error, "个人资料暂时不可用")
						: "";
				this.setData({
					userLabel:
						displayName || (userPayload.data.user.id ? "微信用户" : "未登录"),
					selectedPatient,
					patientCount: patients.length,
					error:
						resolution.state === "stale"
							? "上次选择的就诊人已不可用，请重新选择就诊人"
							: profileError,
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
		navigateToPatientSelector();
	},

	onAction(event): void {
		const action = event.currentTarget?.dataset?.action;
		switch (action) {
			case "patient-select":
				navigateToPatientSelector();
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
		// `/me` 或患者目录失败时，旧卡片不能继续充当当前会话证据。
		// 这里只清理本页面的派生展示状态，不删除本地 selectedPatientId，
		// 也不清理仍可重试的 token；下一次成功读取目录后仍可恢复原选择，
		// 但在恢复前不会把旧患者数量或资料标签展示给用户。
		this.setData({
			error: safeApiErrorMessage(error, fallback),
			userLabel: "微信用户",
			selectedPatient: null,
			patientCount: 0,
		});
	},
});
