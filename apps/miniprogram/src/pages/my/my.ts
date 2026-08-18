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
	navigateToAuthenticatedPage,
	navigateToPatientScopedPage,
	navigateToPatientSelector,
} from "../../services/patient-navigation";
import { sessionVerificationStateFromError } from "../../services/session-service";
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
 * 较早的异步周期不能再覆盖当前用户和就诊人数量。普通资料属于可降级
 * 展示增强，患者目录属于关键业务上下文，两者的提交边界在 loadPage 中分开。
 */
Page<MyPageData, MyPageMethods>({
	data: {
		hasShown: false,
		sessionState: "checking",
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
		this.setData({
			loading: true,
			error: "",
			sessionState: "checking",
			// 新一轮会话读取开始时先清除上一轮普通资料的展示结果；
			// 否则资料请求失败时，旧昵称会被误认为当前会话资料。
			userLabel: "微信用户",
		});
		const sessionResult = getCurrentUser().then(
			(payload) => {
				if (pageLoadGuard.isCurrent(requestToken)) {
					this.setData({ sessionState: "valid" });
				}
				return payload;
			},
			(error) => {
				if (pageLoadGuard.isCurrent(requestToken)) {
					this.setData({
						sessionState: sessionVerificationStateFromError(error),
					});
				}
				throw error;
			},
		);
		// `/me` 和患者目录决定“我的”页的核心会话上下文，资料只是头像区域的
		// 展示增强。必须先确认 `/me`，再启动患者目录和资料读取：会话失效时不
		// 应额外制造两条必然失败的受保护请求，也不能让依赖读取在会话状态尚未
		// 收敛时抢先进入日志和页面状态。
		return sessionResult
			.then(() => {
				// 当前页面周期已经被新的 onShow/下拉刷新淘汰时，不再启动后续
				// 读取。微信请求本身无法取消，但至少不让旧周期扩大为新的业务请求。
				if (!pageLoadGuard.isCurrent(requestToken)) return undefined;
				// 患者目录是“我的”页的关键业务上下文，普通资料只是头像区的
				// 展示增强。两者可以并行请求，但不能让资料接口的慢响应阻塞
				// 患者卡片、患者数量和业务入口；否则资料服务短暂抖动时，用户
				// 会误以为挂号/报告/费用入口也没有加载完成。
				const applyProfileError = (error: unknown): void => {
					if (!pageLoadGuard.isCurrent(requestToken)) return;
					// 患者目录已经有更重要的错误时，不要用资料失败覆盖它。
					if (this.data.error) return;
					this.setData({
						error: safeApiErrorMessage(error, "个人资料暂时不可用"),
					});
				};
				const profilePromise = getUserProfile()
					.then((response) => {
						if (!pageLoadGuard.isCurrent(requestToken)) return;
						const displayName = response.data.displayName.trim();
						this.setData({
							userLabel: displayName || "微信用户",
							// 患者目录错误优先于资料增强错误；资料成功也不能清除
							// 当前就诊人不可用的业务提示。
							error: this.data.error,
						});
					})
					.catch(applyProfileError);
				// 普通资料请求已经在自己的成功/失败分支中收敛；这里不把它
				// 接入患者关键路径，也不留下未处理的 rejected Promise。
				void profilePromise;
				return loadPatients();
			})
			.then((result) => {
				if (!result) return;
				const patients = result;
				if (!pageLoadGuard.isCurrent(requestToken)) return;
				const resolution = resolveStoredPatientSelection(patients);
				const selectedPatient = resolution.patient ?? null;
				const patientContextError =
					patientSelectionResolutionMessage(resolution);
				this.setData({
					// 资料请求可能已经先完成并写入真实昵称；患者关键路径只
					// 更新自己负责的字段，不能用默认文案覆盖资料增强结果。
					selectedPatient,
					patientCount: patients.length,
					// 患者上下文错误优先于资料增强错误：当前就诊人不可查询是
					// 影响预约、报告和费用入口的业务事实，不能被普通资料提示覆盖。
					error: patientContextError || this.data.error,
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
		navigateToAuthenticatedPage(
			"/pages/profile/profile",
			this.data.sessionState,
		);
	},

	onFamilyTap(): void {
		navigateToPatientSelector(this.data.sessionState);
	},

	onAction(event): void {
		const action = event.currentTarget?.dataset?.action;
		switch (action) {
			case "patient-select":
				navigateToPatientSelector(this.data.sessionState);
				break;
			case "appointment-records":
				navigateToPatientScopedPage(
					"/pages/appointment-records/appointment-records",
					this.data.sessionState,
					Boolean(this.data.selectedPatient),
				);
				break;
			case "missed-appointments":
				navigateToPatientScopedPage(
					"/pages/missed-appointments/missed-appointments",
					this.data.sessionState,
					Boolean(this.data.selectedPatient),
				);
				break;
			case "outpatient-payment":
				navigateToPatientScopedPage(
					"/pages/outpatient-payment/outpatient-payment",
					this.data.sessionState,
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
