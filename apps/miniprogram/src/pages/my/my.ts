import { LEGACY_TAB_BAR_ITEMS } from "../../constants/legacy-tabbar";
import {
	getCurrentUser,
	getUserProfile,
	safeApiErrorMessage,
} from "../../services/api-client";
import { loadPatients } from "../../services/dashboard-service";
import {
	disposePageInstance,
	getPageLatestRequestGuard,
} from "../../services/page-instance-state";
import {
	navigateToPatientScopedPage,
	navigateToPatientSelector,
} from "../../services/patient-navigation";
import { hasPlatformSession } from "../../services/session-service";
import {
	patientContextErrorMessage,
	patientSelectionResolutionMessage,
	resolveStoredPatientSelection,
} from "../../services/patient-selection-service";
import type { ActionEvent, MyPageData } from "../../types";

type MyPageMethods = {
	loadPage(): Promise<void>;
	onHeaderTap(): void;
	onFamilyTap(): void;
	onAction(event: ActionEvent): void;
	onTabTap(event: WechatMiniprogram.TouchEvent): void;
	onPullDownRefresh(): void;
	onUnload(): void;
	showError(error: unknown, fallback: string): void;
};

/**
 * 旧端 `userNavData.json` 的事实顺序和图标资源。
 *
 * 这里不把菜单重新整理成“更合理”的新分类，因为视觉迁移首先要保持
 * 用户已经熟悉的入口位置；每个 action 仍由当前页面统一判断是否已经迁移。
 */
const MY_MENU_SECTIONS = Object.freeze([
	{
		title: "我的订单",
		items: [
			{
				action: "appointment-records",
				icon: "/assets/legacy-user/appointment.svg",
				title: "我的挂号",
			},
			{
				action: "consultation",
				icon: "/assets/legacy-user/consultation.svg",
				title: "我的问诊",
			},
			{
				action: "medical-record",
				icon: "/assets/legacy-user/medical-record.svg",
				title: "门诊病历",
			},
			{
				action: "electronic-consultation",
				icon: "/assets/legacy-user/electronic-consultation.svg",
				title: "电子导诊单",
			},
		],
	},
	{
		title: "我的订单",
		items: [
			{
				action: "doctor",
				icon: "/assets/legacy-user/doctor.svg",
				title: "我的医生",
			},
			{
				action: "missed-appointments",
				icon: "/assets/legacy-user/missed.svg",
				title: "爽约记录",
			},
		],
	},
	{
		title: "我的订单",
		items: [
			{
				action: "feedback",
				icon: "/assets/legacy-user/feedback.svg",
				title: "意见反馈",
			},
			{
				action: "smart-customer",
				icon: "/assets/legacy-user/smart-customer.svg",
				title: "智能客服",
			},
			{
				action: "insurance",
				icon: "/assets/legacy-user/insurance.svg",
				title: "医保电子凭证",
			},
		],
	},
] as const);

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
		hasShown: false,
		userLabel: "微信用户",
		selectedPatient: null,
		patientCount: 0,
		menuSections: MY_MENU_SECTIONS,
		// 底部导航与首页共用旧端资源，确保切换页面时文案和激活态不漂移。
		tabBarItems: LEGACY_TAB_BAR_ITEMS,
		loading: true,
		error: "",
	},

	onLoad() {
		// 首次 onShow 只消费 onLoad 已发起的读取；该状态必须属于当前
		// 页面实例，不能用 loading 推断，否则快速响应时会重复请求。
		this.setData({ hasShown: false });
		this.loadPage();
	},

	/** 页面恢复时重新读取患者数量和当前选择，避免与患者选择页脱节。 */
	onShow() {
		if (!this.data.hasShown) {
			this.setData({ hasShown: true });
			return;
		}
		this.loadPage();
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
				const patientContextError =
					patientSelectionResolutionMessage(resolution);
				this.setData({
					userLabel:
						displayName || (userPayload.data.user.id ? "微信用户" : "未登录"),
					selectedPatient,
					patientCount: patients.length,
					// 患者上下文错误优先于资料增强错误：当前就诊人不可查询是
					// 影响预约、报告和费用入口的业务事实，不能被普通资料提示覆盖。
					error: patientContextError || profileError,
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
				navigateToPatientScopedPage(
					"/pages/appointment-records/appointment-records",
					hasPlatformSession(),
					Boolean(this.data.selectedPatient),
				);
				break;
			case "missed-appointments":
				navigateToPatientScopedPage(
					"/pages/missed-appointments/missed-appointments",
					hasPlatformSession(),
					Boolean(this.data.selectedPatient),
				);
				break;
			case "outpatient-payment":
				navigateToPatientScopedPage(
					"/pages/outpatient-payment/outpatient-payment",
					hasPlatformSession(),
					Boolean(this.data.selectedPatient),
				);
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

	/** 页面卸载后让会话/患者目录读取失去回写资格。 */
	onUnload(): void {
		disposePageInstance(this);
	},

	showError(error: unknown, fallback: string): void {
		// `/me` 或患者目录失败时，旧卡片不能继续充当当前会话证据。
		// 这里只清理本页面的派生展示状态，不删除本地 selectedPatientId，
		// 也不清理仍可重试的 token；下一次成功读取目录后仍可恢复原选择，
		// 但在恢复前不会把旧患者数量或资料标签展示给用户。
		this.setData({
			error: patientContextErrorMessage(error, fallback),
			userLabel: "微信用户",
			selectedPatient: null,
			patientCount: 0,
		});
	},
});
