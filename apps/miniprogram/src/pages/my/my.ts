import { ApiError } from "../../services/api-client";
import { loadPatientsForOwner } from "../../services/dashboard-service";
import { errorMessageWithCode } from "../../services/error-presentation";
import { navigateToFeatureEntry } from "../../services/feature-navigation";
import {
	type GlobalUserProfileState,
	getGlobalUserProfile,
	refreshGlobalUserProfile,
	saveGlobalWechatProfileSelection,
	subscribeGlobalUserProfile,
	waitForGlobalUserProfile,
} from "../../services/global-user-profile";
import { navigateToInsuranceVoucher } from "../../services/insurance-voucher-navigation";
import {
	disposePageInstance,
	getPageLatestRequestGuard,
} from "../../services/page-instance-state";
import {
	navigateToAuthenticatedPage,
	navigateToMissedAppointmentsPage,
	navigateToPatientScopedPage,
	navigateToPatientSelector,
} from "../../services/patient-navigation";
import {
	patientContextErrorMessage,
	patientSelectionResolutionMessage,
	resolveStoredPatientSelection,
} from "../../services/patient-selection-service";
import {
	disposePageSessionResetListener,
	registerPageSessionResetListener,
} from "../../services/session-events";
import { isCurrentSessionGeneration } from "../../services/session-generation";
import {
	hasPlatformSession,
	sessionStateAfterAuthenticatedReadError,
	sessionVerificationStateFromError,
} from "../../services/session-service";
import type { ActionEvent, MyPageData } from "../../types";

type MyPageMethods = {
	loadPage(forceProfileRefresh?: boolean): Promise<void>;
	onHeaderTap(): void;
	onWechatProfileTap(): Promise<void>;
	onProfileAvatarChosen(event: { detail?: { avatarUrl?: unknown } }): void;
	onProfileNicknameInput(event: { detail?: { value?: unknown } }): void;
	onProfileEditorPanelTap(): void;
	onProfileEditorCancel(): void;
	onProfileEditorSave(): Promise<void>;
	onFamilyTap(): void;
	onAction(event: ActionEvent): void;
	onRetry(): void;
	onPullDownRefresh(): void;
	onUnload(): void;
	showError(error: unknown, fallback: string): void;
};

/** 页面实例只保存取消订阅函数；资料事实归 App 全局仓库所有。 */
const myPageProfileSubscriptions = new WeakMap<object, () => void>();

function applyGlobalProfileToPage(
	page: WechatMiniprogram.Page.Instance<MyPageData, MyPageMethods>,
	state: GlobalUserProfileState,
): void {
	if (state.status === "loading" && !state.ownerId) {
		page.setData({
			userLabel: "微信用户",
			avatarUrl: "",
			wechatProfileState: "idle",
			wechatProfileHint: "正在获取用户信息...",
		});
		return;
	}
	page.setData({
		userLabel: state.displayName || "微信用户",
		avatarUrl: state.avatarUrl,
		wechatProfileState: state.wechatProfileState,
		wechatProfileHint:
			state.wechatProfileHint ||
			(state.status === "error"
				? "普通资料暂不可用，仍可点击获取头像和昵称"
				: ""),
	});
}

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
 * 统一进入状态页说明关闭原因，不能用统一 Toast 造成“点了没反应”，
 * 更不能在这里绕过平台 API 直连旧 WebView、医生关系接口或医保小程序。
 */
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
		avatarUrl: "",
		wechatProfileState: "idle",
		wechatProfileHint: "",
		profileEditorVisible: false,
		profileDraftName: "",
		profileDraftAvatarUrl: "",
		profileSaving: false,
		selectedPatient: null,
		patientCount: 0,
		menuSections: MY_MENU_SECTIONS,
		loading: true,
		error: "",
	},

	onLoad() {
		// 首次 onShow 只消费 onLoad 已发起的读取；该状态必须属于当前
		// 页面实例，不能用 loading 推断，否则快速响应时会重复请求。
		this.setData({ hasShown: false });
		registerPageSessionResetListener(
			this,
			() => {
				// 全局资料仓库会清理昵称和头像，但“我的”页还持有独立的
				// 患者目录快照；两者必须在同一个会话事件中一起撤销，不能出现
				// 新账号头像配旧账号就诊人数的混合帧。回读由 onShow/重试负责。
				this.setData({
					sessionState: "checking",
					selectedPatient: null,
					patientCount: 0,
					profileEditorVisible: false,
					profileDraftName: "",
					profileDraftAvatarUrl: "",
					profileSaving: false,
					loading: true,
					error: "",
				});
			},
			() => this.loadPage(),
		);
		const unsubscribe = subscribeGlobalUserProfile((state) =>
			applyGlobalProfileToPage(this, state),
		);
		myPageProfileSubscriptions.set(this, unsubscribe);
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

	loadPage(forceProfileRefresh = false): Promise<void> {
		const pageLoadGuard = getPageLatestRequestGuard(this, "my-page");
		const requestToken = pageLoadGuard.begin();
		// 全局资料仓库负责 `/me`、`/me/profile` 和本机微信资料缓存；本页面
		// 只等待同一个 Promise，再读取患者目录。这样切换 Tab 不会重新获取
		// 用户昵称/头像，也不会在每次 onShow 时把资料卡清成默认值。
		let expectedSessionGeneration = -1;
		let expectedOwnerId = "";
		this.setData({
			loading: true,
			error: "",
			sessionState: "checking",
			// 患者目录必须和本轮会话重新绑定；在新目录完成前不能保留
			// 上一轮患者卡片或数量，避免资料/患者读取失败时出现混合快照。
			selectedPatient: null,
			patientCount: 0,
		});
		const profilePromise = forceProfileRefresh
			? refreshGlobalUserProfile()
			: waitForGlobalUserProfile();
		return profilePromise
			.then((profileState) => {
				if (!pageLoadGuard.isCurrent(requestToken)) return undefined;
				if (!profileState.ownerId || !hasPlatformSession()) {
					this.setData({
						sessionState: sessionVerificationStateFromError(
							new ApiError("No verified platform session", {
								code: "unauthorized",
							}),
						),
						error: profileState.error || "登录状态已失效，请重新登录",
					});
					return undefined;
				}
				expectedOwnerId = profileState.ownerId;
				expectedSessionGeneration = profileState.sessionGeneration;
				this.setData({
					sessionState: "valid",
					error: profileState.error || "",
				});
				// 个人资料是全局共享的；患者目录仍然需要在本页面重新确认，
				// 因为用户可能刚从患者选择页返回，当前选择不能由全局资料代替。
				return loadPatientsForOwner(expectedOwnerId);
			})
			.then((result) => {
				if (!result) return;
				// 患者请求在 Promise 完成后、setData 前仍可能遇到另一个
				// 页面换号；响应级 guard 已无法替代这里的组合一致性检查。
				expectedSessionGeneration = result.sessionGeneration;
				if (!isCurrentSessionGeneration(expectedSessionGeneration)) {
					throw new ApiError("Session changed while reading patients", {
						code: "session-changed",
					});
				}
				const { patients } = result;
				if (!pageLoadGuard.isCurrent(requestToken)) return;
				const resolution = resolveStoredPatientSelection(patients);
				const selectedPatient = resolution.patient ?? null;
				const patientContextError =
					patientSelectionResolutionMessage(resolution);
				this.setData({
					// 资料请求已经完成或安全降级；患者关键路径只更新自己负责
					// 的字段，不能用默认文案覆盖资料增强结果。
					selectedPatient,
					patientCount: patients.length,
					// 患者上下文错误优先于资料增强错误：当前就诊人不可查询是
					// 影响预约、报告和费用入口的业务事实，不能被普通资料提示覆盖。
					error: patientContextError || this.data.error,
				});
			})
			.catch((error) => {
				if (pageLoadGuard.isCurrent(requestToken)) {
					if (error instanceof ApiError && error.code === "session-changed") {
						// 不把混合快照伪装成普通网络错误，也不在当前页面自动
						// 重放；清理派生数据后由用户下拉刷新，先重新取得完整
						// `/me` owner 证明，再读取资料和患者目录。
						this.setData({
							sessionState: "checking",
							selectedPatient: null,
							patientCount: 0,
							error: "登录状态需要重新确认，请稍后再试",
						});
						return;
					}
					this.setData({
						sessionState: sessionStateAfterAuthenticatedReadError(
							error,
							this.data.sessionState,
							hasPlatformSession(),
						),
					});
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

	/** 用户主动打开微信头像选择和昵称填写面板。 */
	onWechatProfileTap(): Promise<void> {
		if (this.data.profileSaving) {
			wx.showToast({ title: "正在保存头像和昵称，请稍候", icon: "none" });
			return Promise.resolve();
		}
		if (this.data.sessionState !== "valid") {
			wx.showToast({ title: "请先完成登录验证", icon: "none" });
			return Promise.resolve();
		}
		const globalProfile = getGlobalUserProfile();
		if (
			(globalProfile.status !== "ready" && globalProfile.status !== "error") ||
			!globalProfile.ownerId ||
			!isCurrentSessionGeneration(globalProfile.sessionGeneration)
		) {
			this.setData({
				wechatProfileState: "idle",
				wechatProfileHint:
					globalProfile.status === "error"
						? "普通资料暂不可用，仍可点击获取头像和昵称"
						: "个人资料尚未加载完成，请稍后重试",
			});
			return Promise.resolve();
		}
		this.setData({
			profileEditorVisible: true,
			profileDraftName:
				globalProfile.displayName === "微信用户"
					? ""
					: globalProfile.displayName,
			profileDraftAvatarUrl: globalProfile.avatarUrl,
		});
		return Promise.resolve();
	},

	/** `chooseAvatar` 只暂存本次微信沙箱路径，点击保存后才进入全局资料。 */
	onProfileAvatarChosen(event): void {
		const avatarUrl = event.detail?.avatarUrl;
		if (typeof avatarUrl !== "string" || !avatarUrl.trim()) {
			wx.showToast({ title: "头像选择失败，请重试", icon: "none" });
			return;
		}
		this.setData({ profileDraftAvatarUrl: avatarUrl.trim() });
	},

	/** `input[type=nickname]` 提供微信昵称填写能力，输入只留在页面草稿。 */
	onProfileNicknameInput(event): void {
		const value = event.detail?.value;
		this.setData({ profileDraftName: typeof value === "string" ? value : "" });
	},

	/** 阻止头像昵称面板内部点击冒泡到遮罩关闭动作。 */
	onProfileEditorPanelTap(): void {},

	onProfileEditorCancel(): void {
		if (this.data.profileSaving) return;
		this.setData({
			profileEditorVisible: false,
			profileDraftName: "",
			profileDraftAvatarUrl: "",
		});
	},

	/** 用户确认两项资料后，立即更新当前页面并持久化昵称。 */
	onProfileEditorSave(): Promise<void> {
		if (this.data.profileSaving) return Promise.resolve();
		if (!this.data.profileDraftAvatarUrl.trim()) {
			wx.showToast({ title: "请先选择头像", icon: "none" });
			return Promise.resolve();
		}
		if (!this.data.profileDraftName.trim()) {
			wx.showToast({ title: "请先填写昵称", icon: "none" });
			return Promise.resolve();
		}
		this.setData({ profileSaving: true });
		return saveGlobalWechatProfileSelection({
			nickName: this.data.profileDraftName,
			avatarUrl: this.data.profileDraftAvatarUrl,
		})
			.then(() => {
				this.setData({
					profileEditorVisible: false,
					profileDraftName: "",
					profileDraftAvatarUrl: "",
				});
				wx.showToast({ title: "头像昵称已更新", icon: "success" });
			})
			.catch((error: unknown) => {
				if (error instanceof ApiError && error.code === "session-changed") {
					this.setData({ error: "登录状态需要重新确认，请稍后再试" });
					return;
				}
				if (
					error instanceof Error &&
					error.name === "WechatUserProfileSelectionError"
				) {
					wx.showToast({ title: "头像或昵称不完整，请重新填写", icon: "none" });
					return;
				}
				wx.showToast({ title: "保存头像昵称失败，请重试", icon: "none" });
			})
			.finally(() => {
				this.setData({ profileSaving: false });
			});
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
					this.data.selectedPatient,
				);
				break;
			case "missed-appointments":
				// 爽约页只要求已验证会话，不能经过患者范围入口自动弹出
				// “选择就诊人”模块；患者上下文由页面自己的只读查询处理。
				navigateToMissedAppointmentsPage(this.data.sessionState);
				break;
			case "outpatient-payment":
				navigateToPatientScopedPage(
					"/pages/outpatient-payment/outpatient-payment",
					this.data.sessionState,
					this.data.selectedPatient,
				);
				break;
			case "medical-record":
				// 报告目录与门诊病历是两类不同医疗事实，不能复用 reports 路由。
				navigateToFeatureEntry("medical-record");
				break;
			case "electronic-consultation":
				navigateToFeatureEntry("electronic-consultation");
				break;
			case "consultation":
				navigateToFeatureEntry("consultation");
				break;
			case "doctor":
				navigateToFeatureEntry("doctor");
				break;
			case "smart-customer":
				navigateToFeatureEntry("smart-customer");
				break;
			case "insurance":
				navigateToInsuranceVoucher();
				break;
			case "feedback":
				// 旧端反馈页目前也是静态问答和客服电话，在线反馈提交仍未开放。
				wx.navigateTo({ url: "/pages/feedback/feedback" });
				break;
			default:
				wx.showToast({ title: "该服务正在完善中，请稍后再试", icon: "none" });
		}
	},

	onPullDownRefresh(): void {
		this.loadPage(true).finally(() => wx.stopPullDownRefresh());
	},

	/**
	 * “我的”页错误态的显式恢复入口必须重新组合 `/me`、资料和患者目录。
	 * 不单独补读某一张卡片，避免资料、当前用户和就诊人数量来自不同会话代际。
	 */
	onRetry(): void {
		if (this.data.loading) return;
		void this.loadPage(true);
	},

	/** 页面卸载后让会话/患者目录读取失去回写资格。 */
	onUnload(): void {
		disposePageSessionResetListener(this);
		myPageProfileSubscriptions.get(this)?.();
		myPageProfileSubscriptions.delete(this);
		disposePageInstance(this);
	},

	showError(error: unknown, fallback: string): void {
		// 患者目录失败不等于个人资料失败；全局资料仍然是当前账号的已确认
		// 快照，不能因为某个业务列表暂时不可用就把昵称头像清成匿名状态。
		this.setData({
			error: errorMessageWithCode(
				error,
				patientContextErrorMessage(error, fallback),
			),
			selectedPatient: null,
			patientCount: 0,
		});
	},
});
