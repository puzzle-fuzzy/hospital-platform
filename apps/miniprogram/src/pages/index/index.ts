import { LEGACY_TAB_BAR_ITEMS } from "../../constants/legacy-tabbar";
import { ApiError } from "../../services/api-client";
import {
	loadHealth,
	loadPatients,
	syncPatientsFromHospital,
} from "../../services/dashboard-service";
import {
	disposePageInstance,
	getPageLifecycle,
	getPageLatestRequestGuard,
	getPageSingleFlight,
} from "../../services/page-instance-state";
import {
	navigateToAuthenticatedPage,
	navigateToPatientScopedPage,
	navigateToPatientSelector,
} from "../../services/patient-navigation";
import {
	clearSelectedPatientId,
	getSelectedPatientId,
	patientContextErrorMessage,
	patientSelectionResolutionMessage,
	resolveStoredPatientSelection,
	setSelectedPatientId,
} from "../../services/patient-selection-service";
import {
	hasPlatformSession,
	restorePlatformSession,
	sessionVerificationStateFromError,
	sessionVerificationStateFromLabel,
	signInPlatformSession,
} from "../../services/session-service";
import { getSessionGeneration } from "../../services/session-generation";
import type {
	ActionEvent,
	IndexEvent,
	IndexPageData,
	Patient,
	PatientEvent,
	ServiceTab,
	SessionLabel,
	TopTabItem,
} from "../../types";

/** 页面显示状态集中定义，避免业务代码散落中文状态常量。 */
const SESSION_LABELS = Object.freeze({
	signedOut: "未登录",
	restoring: "验证会话中",
	unavailable: "会话暂不可用",
	restored: "已恢复会话",
	signedIn: "已登录",
} as const satisfies Record<string, SessionLabel>);

/** 顶部四项沿用旧端的顺序、图标尺寸和文案；动作仅接入当前已开放的安全入口。 */
const TOP_TAB_LIST = Object.freeze([
	{
		action: "appointments",
		icon: "/assets/legacy-home/top-registration.svg",
		text: "预约挂号",
	},
	{
		action: "outpatient-payment",
		icon: "/assets/legacy-home/top-payment.svg",
		text: "门诊缴费",
	},
	{
		// 旧首页虽然把入口命名为“互联网医院”，实际 URL 是静态 hospitalList；
		// 外部互联网医院 web-view 是另一个旧顶层页面，不能与此入口混为一谈。
		action: "hospital-list",
		icon: "/assets/legacy-home/top-internet.svg",
		text: "互联网医院",
	},
	{
		action: "medical-record",
		icon: "/assets/legacy-home/top-record.svg",
		text: "门诊病历",
	},
] satisfies ReadonlyArray<TopTabItem>);

/** 旧端轮播图当前只有同一张关注公众号宣传图，保留原三页轮播节奏。 */
const BANNER_LIST = Object.freeze([
	{ action: "follow", image: "/assets/legacy-home/banner-follow.png" },
	{ action: "follow", image: "/assets/legacy-home/banner-follow.png" },
	{ action: "follow", image: "/assets/legacy-home/banner-follow.png" },
] satisfies ReadonlyArray<{ action: string; image: string }>);

/** 右侧快捷图直接复用旧端图片；报告查询是当前原生端唯一已接入的入口。 */
const RIGHT_LIST = Object.freeze([
	{ action: "guide", image: "/assets/legacy-home/right-guide.png" },
	{ action: "companion", image: "/assets/legacy-home/right-companion.png" },
	{ action: "reports", image: "/assets/legacy-home/report.png" },
] satisfies ReadonlyArray<{ action: string; image: string }>);

/** 门诊/住院/便民服务清单按旧端原始顺序和图标复刻，未开放动作保持空值。 */
const SERVICE_TABS = Object.freeze([
	{
		title: "门诊",
		items: [
			{
				action: "appointment-records",
				icon: "/assets/legacy-home/service-registration.svg",
				title: "我的挂号",
			},
			{
				action: "patient-select",
				icon: "/assets/legacy-home/service-patient.svg",
				title: "就诊人绑定",
			},
			{
				icon: "/assets/legacy-home/service-consultation.svg",
				title: "我的问诊",
			},
			{
				icon: "/assets/legacy-home/service-record.svg",
				title: "门诊病历",
			},
			{
				icon: "/assets/legacy-home/service-consultation-form.svg",
				title: "电子导诊单",
			},
		],
	},
	{
		title: "住院",
		items: [
			{
				icon: "/assets/legacy-home/service-inpatient.svg",
				title: "住院信息查询",
			},
			{
				icon: "/assets/legacy-home/service-inpatient-payment.svg",
				title: "住院预缴",
			},
			{
				icon: "/assets/legacy-home/service-admission.svg",
				title: "入院预问诊",
			},
			{
				icon: "/assets/legacy-home/service-followup.svg",
				title: "出院随访",
			},
			{
				icon: "/assets/legacy-home/service-risk.svg",
				title: "风险自评",
			},
		],
	},
	{
		title: "便民",
		items: [
			{
				action: "hospital-navigation",
				icon: "/assets/legacy-home/service-navigation.svg",
				title: "院内导航",
			},
			{
				icon: "/assets/legacy-home/service-test.svg",
				title: "健康自测",
			},
			{
				icon: "/assets/legacy-home/service-encyclopedia.svg",
				title: "健康百科",
			},
			{
				icon: "/assets/legacy-home/service-banner.svg",
				title: "电子锦旗",
			},
			{
				icon: "/assets/legacy-home/service-praise.svg",
				title: "表扬信",
			},
		],
	},
] satisfies ReadonlyArray<ServiceTab>);

type IndexPageMethods = {
	checkHealth(): Promise<void>;
	onLogin(options?: LoginOptions): void;
	onHeroAction(): void;
	openPatientSelector(): void;
	onPatientQr(): void;
	onTopAction(event: ActionEvent): void;
	onRightAction(event: ActionEvent): void;
	onTabBarAction(event: IndexEvent): void;
	onFloatingGuide(): void;
	executeQuickAction(action?: string): void;
	onServiceTabChange(event: IndexEvent): void;
	onServiceItemTap(event: ActionEvent): void;
	loadPatients(): Promise<Array<Patient>>;
	onSyncPatients(): Promise<void>;
	onLoadAppointments(): void;
	onLoadOutpatientPayment(): void;
	onRefresh(): Promise<void>;
	onPullDownRefresh(): void;
	onUnload(): void;
	onLoadReports(): void;
	onLoadAppointmentRecords(): void;
	onSelectPatient(event: PatientEvent): void;
	showError(error: unknown, fallback: string): void;
	clearDisplayedPatientContext(): void;
	clearPatientContext(): void;
	setPatientsFromPayload(patients: Array<Patient>): void;
};

type LoginOptions = {
	/** 登录完成并完成必要的首页初始化后，继续用户刚才触发的动作。 */
	afterSuccess?: () => void;
	/** 需要跳转到会自行读取目录的页面时，避免首页重复请求患者同步。 */
	skipPatientBootstrap?: boolean;
};

/**
 * 首页可能同时发生会话恢复、下拉刷新和目录同步。各类 guard 使用固定
 * key 存在页面实例的 WeakMap 中：同一首页实例内后发的同步会淘汰旧读取，
 * 但不会影响页面栈中的另一个首页实例。
 *
 * 同一首页实例内的患者同步采用页面级单飞语义；dashboard service 另外使用
 * 进程级协调器，让首页与选择页等不同页面实例复用同一在途 Promise。客户端锁
 * 只减少重复请求和无意义的 409，真正的跨进程幂等仍由服务端 operation ledger 保证。
 */
Page<IndexPageData, IndexPageMethods>({
	data: {
		hasShown: false,
		status: "加载中",
		service: "",
		sessionStatus: SESSION_LABELS.signedOut,
		topTabList: TOP_TAB_LIST,
		bannerList: BANNER_LIST,
		rightList: RIGHT_LIST,
		tabBarItems: LEGACY_TAB_BAR_ITEMS,
		serviceTabs: SERVICE_TABS,
		activeServiceTab: 0,
		// 单独维护当前分组，避免 WXML 依赖嵌套数组下标表达式，提升真机兼容性。
		activeServiceItems: SERVICE_TABS[0]?.items ?? [],
		patients: [],
		selectedPatient: null,
		// 只保存服务端返回的内部 patientId，后续查询均以它作为业务输入。
		selectedPatientId: "",
		hasPatients: false,
		loading: false,
		syncingPatients: false,
		error: "",
	},

	onLoad() {
		// 生命周期状态必须保存在页面实例 data 内；模块热复用或多层页面栈
		// 不能共享“是否首次展示”的标记。
		this.setData({ hasShown: false });
		this.checkHealth();
		const selectedPatientId = getSelectedPatientId();
		if (selectedPatientId) this.setData({ selectedPatientId });
		if (!hasPlatformSession()) return;

		const sessionGuard = getPageLatestRequestGuard(this, "session");
		const sessionToken = sessionGuard.begin();
		this.setData({ sessionStatus: SESSION_LABELS.restoring });
		restorePlatformSession()
			.then(() => {
				if (!sessionGuard.isCurrent(sessionToken)) return;
				this.setData({ sessionStatus: SESSION_LABELS.restored });
				return this.loadPatients();
			})
			.then(() => {
				if (!sessionGuard.isCurrent(sessionToken)) return;
				// 恢复旧会话后也要重建一次临床患者映射；仅读取旧目录数据会让预约、报告
				// 和门诊费用继续使用过期的上游映射，导致“患者信息不存在”。
				return this.onSyncPatients();
			})
			.catch((error) => {
				if (!sessionGuard.isCurrent(sessionToken)) return;
				// 恢复失败时没有拿到当前 principal 的证明，旧患者卡片不能继续
				// 作为新业务页的上下文；这里只清理页面派生数据，不删除本地选择，
				// 让 Redis/网络恢复后仍可重新验证原会话。若此时删除选择，下一次
				// 目录恢复会把第一位患者误当成用户刚才明确选择的人。
				this.clearDisplayedPatientContext();
				this.setData({
					sessionStatus:
						sessionVerificationStateFromError(error) === "invalid"
							? SESSION_LABELS.signedOut
							: SESSION_LABELS.unavailable,
				});
				this.showError(error, "会话恢复失败");
			});
	},

	/**
	 * 从子页面返回时重新读取 owner-scoped 目录，而不是只比较本地 patientId。
	 *
	 * 患者选择页可能刚完成一次完整同步：旧患者会变成 inactive，或者目录
	 * 直接变为空。此时本地缓存中的旧 ID 可能仍然存在（stale 分支故意保留，
	 * 等待用户显式重选），所以“ID 没变化”不能证明首页仍然可以展示旧患者。
	 * 首次 onShow 由 onLoad 发起的读取负责，避免微信生命周期造成重复请求；
	 * 之后每次返回都读取最新目录，确保首页不会保留过期的患者上下文。
	 */
	onShow() {
		if (!this.data.hasShown) {
			this.setData({ hasShown: true });
			return;
		}

		if (!hasPlatformSession()) {
			// 会话失效时不继续展示上一位患者；重新登录后由目录读取恢复。
			clearSelectedPatientId();
			this.setData({
				sessionStatus: SESSION_LABELS.signedOut,
				patients: [],
				selectedPatient: null,
				selectedPatientId: "",
				hasPatients: false,
			});
			return;
		}

		const pageLifecycle = getPageLifecycle(this);
		this.loadPatients().catch((error) => {
			if (pageLifecycle.isActive()) {
				this.showError(error, "就诊人刷新失败");
			}
		});
	},

	checkHealth(): Promise<void> {
		const healthGuard = getPageLatestRequestGuard(this, "health");
		const requestToken = healthGuard.begin();
		return loadHealth()
			.then((payload) => {
				if (!healthGuard.isCurrent(requestToken)) return;
				this.setData({
					status: payload.data.status,
					service: payload.data.service,
					error: "",
				});
			})
			.catch((error) => {
				if (healthGuard.isCurrent(requestToken)) {
					this.showError(error, "服务不可用");
				}
			});
	},

	onLogin(options: LoginOptions = {}) {
		// 主动重新登录前若已没有可验证会话，先清掉旧页面实例中的患者数据。
		// 否则 auth/wechat 返回 503 时，用户可能看到旧患者而误以为登录成功。
		if (!hasPlatformSession()) this.clearPatientContext();
		const sessionGuard = getPageLatestRequestGuard(this, "session");
		const sessionToken = sessionGuard.begin();
		// 主动登录期间不能继续沿用上一次的“已登录”文案；入口门禁必须保持
		// checking，直到服务端确认新会话，或明确收敛为 invalid/unavailable。
		this.setData({
			loading: true,
			error: "",
			sessionStatus: SESSION_LABELS.restoring,
		});
		signInPlatformSession()
			.then(() => {
				if (!sessionGuard.isCurrent(sessionToken)) return;
				this.setData({ sessionStatus: SESSION_LABELS.signedIn });
				// wx.login 是静默的 code 交换；用成功提示让用户知道平台会话已建立，
				// 不额外索取与医疗业务无关的头像和昵称权限。
				wx.showToast({ title: "微信登录成功", icon: "success" });
				if (options.skipPatientBootstrap) return Promise.resolve();
				return this.loadPatients().then(() => undefined);
			})
			.then(() => {
				if (!sessionGuard.isCurrent(sessionToken)) return;
				if (options.skipPatientBootstrap) return;
				// 新登录同样主动同步，兼容迁移前已经存在的目录患者记录，并补齐临床映射。
				return this.onSyncPatients();
			})
			.then(() => {
				if (!sessionGuard.isCurrent(sessionToken)) return;
				return options.afterSuccess?.();
			})
			.catch((error) => {
				if (!sessionGuard.isCurrent(sessionToken)) return;
				// 登录失败不能留下“有患者但无会话”的半登录状态；只有确认
				// 没有本地 token 才清除，避免 Redis 短暂故障时误删仍可重试的会话。
				if (!hasPlatformSession()) {
					this.clearPatientContext();
					this.setData({ sessionStatus: SESSION_LABELS.signedOut });
				} else if (sessionVerificationStateFromError(error) === "unavailable") {
					// Redis/网络暂时失败时保留 token，但把入口从“验证中”收敛到
					// 明确的暂不可用，允许用户理解失败原因并稍后重试。
					this.setData({ sessionStatus: SESSION_LABELS.unavailable });
				}
				this.showError(error, "登录失败");
			})
			.finally(() => {
				if (sessionGuard.isCurrent(sessionToken)) {
					this.setData({ loading: false });
				}
			});
	},

	/** 顶部就诊人卡片的主动作：未登录先登录，已有患者进入独立选择页。 */
	onHeroAction() {
		if (!hasPlatformSession()) {
			// 选择页会再次读取并同步目录；登录阶段只建立平台会话，避免首页与
			// 选择页同时请求 provider，导致首次进入出现重复同步和竞态提示。
			this.onLogin({
				afterSuccess: () => this.openPatientSelector(),
				skipPatientBootstrap: true,
			});
			return;
		}
		// “新增就诊人”和“更换就诊人”都必须进入独立选择页；
		// 不能在首页只刷新目录或静默使用当前用户。选择页会负责
		// 读取目录、同步临床映射，并在绑定接口未开放时给出明确提示。
		this.openPatientSelector();
	},

	/** 统一通过页面路由进入患者管理，恢复旧端可浏览、可返回的交互。 */
	openPatientSelector(): void {
		// 患者同步可能由首页、我的或其他业务页发起；统一导航服务检查
		// 进程级在途 Promise，不能只看当前首页的 syncingPatients。这样即使
		// 首页已经隐藏，选择页也不会带另一条幂等键并发触发 provider 同步。
		navigateToPatientSelector(
			sessionVerificationStateFromLabel(this.data.sessionStatus),
		);
	},

	/**
	 * 旧端二维码依赖完整医疗卡号和第三方二维码服务，当前没有医院扫码协议，
	 * 因此只给出明确迁移状态，不生成伪二维码，也不把医疗标识发送给第三方。
	 */
	onPatientQr() {
		wx.showModal({
			title: this.data.selectedPatientId ? "二维码暂未开放" : "暂无就诊人",
			content: this.data.selectedPatientId
				? "医院扫码字段和有效期协议确认后开放，请先使用实体就诊卡或窗口服务。"
				: "请先登录并选择就诊人。",
			showCancel: false,
		});
	},

	onTopAction(event: ActionEvent): void {
		this.executeQuickAction(event.currentTarget?.dataset?.action);
	},

	onRightAction(event: ActionEvent): void {
		this.executeQuickAction(event.currentTarget?.dataset?.action);
	},

	onTabBarAction(event: IndexEvent): void {
		const index = Number(event.currentTarget?.dataset?.index);
		if (index === 0) return;
		if (index === 3) {
			wx.navigateTo({ url: "/pages/my/my" });
			return;
		}
		wx.showToast({ title: "该页面正在迁移中", icon: "none" });
	},

	onFloatingGuide() {
		wx.showToast({ title: "智能客服功能迁移中", icon: "none" });
	},

	executeQuickAction(action?: string): void {
		switch (action) {
			case "patient-select":
				this.openPatientSelector();
				break;
			case "sync":
				this.onSyncPatients();
				break;
			case "appointments":
				this.onLoadAppointments();
				break;
			case "outpatient-payment":
				this.onLoadOutpatientPayment();
				break;
			case "hospital-list":
				// 保留旧首页实际跳转的 hospitalList；动态机构和外部互联网医院仍未开放。
				// 预约目录虽不需要患者，但仍必须先通过平台会话门禁。
				this.onLoadAppointments();
				break;
			case "follow":
				// 旧轮播图只进入公众号静态说明页，不把“已关注”误判成微信授权事实。
				wx.navigateTo({ url: "/pages/official-account/official-account" });
				break;
			case "appointment-records":
				this.onLoadAppointmentRecords();
				break;
			case "reports":
				this.onLoadReports();
				break;
			case "medical-record":
				// 报告目录不能冒充门诊病历；病历 contract 完成前明确提示迁移状态。
				wx.showToast({ title: "门诊病历正在迁移中", icon: "none" });
				break;
			case "hospital-navigation":
				wx.navigateTo({
					url: "/pages/hospital-navigation/hospital-navigation",
				});
				break;
			default:
				wx.showToast({ title: "该服务正在建设中", icon: "none" });
		}
	},

	onServiceTabChange(event: IndexEvent): void {
		const index = Number(event.currentTarget?.dataset?.index);
		if (!Number.isInteger(index) || index < 0 || index >= SERVICE_TABS.length)
			return;
		const selectedTab = SERVICE_TABS[index];
		if (!selectedTab) return;
		this.setData({
			activeServiceTab: index,
			activeServiceItems: selectedTab.items,
		});
	},

	onServiceItemTap(event: ActionEvent): void {
		this.executeQuickAction(event.currentTarget?.dataset?.action);
	},

	loadPatients(): Promise<Array<Patient>> {
		const patientDataGuard = getPageLatestRequestGuard(this, "patients");
		const requestToken = patientDataGuard.begin();
		return loadPatients()
			.then((patients) => {
				if (patientDataGuard.isCurrent(requestToken)) {
					this.setPatientsFromPayload(patients);
				}
				return patients;
			})
			.catch((error) => {
				if (!patientDataGuard.isCurrent(requestToken)) {
					// 新一轮目录读取或页面卸载已经取消了本次请求；旧错误不能再
					// 冒泡给 onShow/onRefresh，否则外层回调可能清空新请求的结果，
					// 或在页面销毁后继续 setData。失去回写资格的请求按安全的
					// 空完成收敛，调用方只处理仍属于当前页面的失败。
					return [];
				}
				// 目录读取失败时，当前首页的患者卡片不再具有最新 owner-scoped
				// 证据；清理展示状态但保留本地 opaque 选择，便于下一次恢复。
				this.clearDisplayedPatientContext();
				throw error;
			});
	},

	/**
	 * 首页同步只返回“同步流程已结束”，不向调用方返回患者快照。
	 *
	 * 成功的空目录和失败兜底都可能表现为数组长度为 0；如果这里返回
	 * `[]`，后续调用方就无法区分“医院确认没有就诊人”和“同步失败”。
	 * 患者快照只允许通过页面状态和服务端成功响应进入展示，失败则由本页
	 * 清理展示上下文并保留可重试的会话，避免把错误伪装成业务空结果。
	 */
	onSyncPatients(): Promise<void> {
		const patientSyncFlight = getPageSingleFlight<void>(
			this,
			`patient-sync:${getSessionGeneration()}`,
		);
		return patientSyncFlight.run(() => {
			const patientDataGuard = getPageLatestRequestGuard(this, "patients");
			const syncLoadingGuard = getPageLatestRequestGuard(this, "sync-loading");
			const requestToken = patientDataGuard.begin();
			const loadingToken = syncLoadingGuard.begin();
			this.setData({ syncingPatients: true, error: "" });
			return syncPatientsFromHospital("patient-sync")
				.then((patients) => {
					if (!patientDataGuard.isCurrent(requestToken)) return;
					// setPatientsFromPayload 已经按本地显式选择解析 empty/stale/
					// unavailable。这里不能再用数组长度覆盖解析结果，否则“已有
					// 患者但最新目录为空”会被错误降级成“从未绑定患者”。
					this.setPatientsFromPayload(patients);
				})
				.catch((error) => {
					if (patientDataGuard.isCurrent(requestToken)) {
						// 临床映射同步失败时，旧卡片也不能继续作为可用患者上下文；
						// 本地选择和会话 token 仍保留，等待用户重试恢复。
						this.clearDisplayedPatientContext();
						this.showError(error, "就诊人同步失败");
					}
				})
				.finally(() => {
					if (syncLoadingGuard.isCurrent(loadingToken)) {
						this.setData({ syncingPatients: false });
					}
				});
		});
	},

	onLoadAppointments() {
		if (!hasPlatformSession()) {
			// 预约目录是公开的只读目录，不需要先同步患者；登录成功后
			// 继续原动作，避免用户看到“登录成功”却仍停在首页。
			this.onLogin({
				afterSuccess: () => this.onLoadAppointments(),
				skipPatientBootstrap: true,
			});
			return;
		}
		// 旧端预约流程先确认医院/院区，再进入科室与排班目录。医院列表目前是
		// 单院区静态配置页，不把未确认的机构接口或路线字段混入新的预约 contract。
		navigateToAuthenticatedPage(
			"/pages/hospital-list/hospital-list",
			sessionVerificationStateFromLabel(this.data.sessionStatus),
		);
	},

	onRefresh(): Promise<void> {
		// 下拉刷新结束必须等待健康检查和患者目录读取都完成；否则用户看到的
		// “刷新完成”并不代表当前患者上下文已经更新，后续业务页可能读到旧映射。
		const patientRefresh = hasPlatformSession()
			? this.loadPatients().catch((error) => {
					if (!getPageLifecycle(this).isActive()) return;
					this.showError(error, "就诊人刷新失败");
				})
			: Promise.resolve();
		return Promise.all([this.checkHealth(), patientRefresh]).then(
			() => undefined,
		);
	},

	onPullDownRefresh() {
		this.onRefresh().finally(() => wx.stopPullDownRefresh());
	},

	/** 页面卸载后让首页的健康、患者目录和同步请求失去回写资格。 */
	onUnload(): void {
		disposePageInstance(this);
	},

	onLoadReports() {
		if (!hasPlatformSession()) {
			this.onLogin({ afterSuccess: () => this.onLoadReports() });
			return;
		}
		// 报告查询拥有独立的患者上下文和空态，不能在首页后台请求后丢失展示结果。
		navigateToPatientScopedPage(
			"/pages/report-directory/report-directory",
			sessionVerificationStateFromLabel(this.data.sessionStatus),
			Boolean(this.data.selectedPatient),
		);
	},

	onLoadAppointmentRecords() {
		if (!hasPlatformSession()) {
			this.onLogin({ afterSuccess: () => this.onLoadAppointmentRecords() });
			return;
		}
		navigateToPatientScopedPage(
			"/pages/appointment-records/appointment-records",
			sessionVerificationStateFromLabel(this.data.sessionStatus),
			Boolean(this.data.selectedPatient),
		);
	},

	/** 门诊费用与预约历史一样必须绑定临床患者，不能先打开再由 API 返回 401。 */
	onLoadOutpatientPayment() {
		if (!hasPlatformSession()) {
			this.onLogin({ afterSuccess: () => this.onLoadOutpatientPayment() });
			return;
		}
		navigateToPatientScopedPage(
			"/pages/outpatient-payment/outpatient-payment",
			sessionVerificationStateFromLabel(this.data.sessionStatus),
			Boolean(this.data.selectedPatient),
		);
	},

	/** 切换患者时清空首页不再持有的报告状态，选择页负责新的患者上下文。 */
	onSelectPatient(event: PatientEvent): void {
		const patientId = event.currentTarget?.dataset?.patientId;
		if (typeof patientId !== "string" || !patientId) return;
		const selectedPatient = this.data.patients.find(
			(patient) => patient.id === patientId,
		);
		if (!selectedPatient) return;
		if (selectedPatient.clinicalAccess !== "ready") {
			// 首页若未来恢复患者快捷切换，也必须沿用选择页的临床可用性门禁；
			// 不能把仅能展示的旧目录记录写入当前患者选择。
			wx.showToast({
				title: "该就诊人暂不可用于查询，请先刷新",
				icon: "none",
			});
			return;
		}

		this.setData({
			selectedPatientId: patientId,
			selectedPatient,
			error: "",
		});
		setSelectedPatientId(patientId);
	},

	showError(error: unknown, fallback: string): void {
		let message = fallback;
		if (error instanceof ApiError) {
			if (error.code === "dependency-not-configured") {
				message = fallback.includes("预约")
					? "预约服务暂未配置完成，请联系管理员"
					: fallback.includes("就诊人")
						? "就诊人服务暂未配置完成，请联系管理员"
						: "服务暂未配置完成，请联系管理员";
			} else {
				message = patientContextErrorMessage(error, fallback);
			}
		}
		this.setData({ error: message });
	},

	/**
	 * 清理首页当前展示的患者派生数据，但不清理本地显式选择。
	 *
	 * 目录或临床映射读取失败时，保留旧 patientId 只用于后续恢复和 stale 判断，
	 * 不能继续把它放在首页卡片上作为当前已确认的患者事实。会话失效或用户明确
	 * 清除上下文时，才调用下面会同步删除本地选择的 clearPatientContext。
	 */
	clearDisplayedPatientContext(): void {
		this.setData({
			patients: [],
			selectedPatient: null,
			selectedPatientId: "",
			hasPatients: false,
		});
	},

	/**
	 * 清理当前首页实例的患者上下文，不清理服务端数据或其他页面实例。
	 *
	 * 患者卡片属于已认证会话的派生读模型；当本地 token 已经失效且新一轮
	 * 微信 code 兑换失败时，宁可展示登录/错误态，也不能继续展示上一位患者。
	 * 这也是从“登录失败”进入“重新登录”的唯一安全收敛点。
	 */
	clearPatientContext(): void {
		clearSelectedPatientId();
		this.setData({
			patients: [],
			selectedPatient: null,
			selectedPatientId: "",
			hasPatients: false,
		});
	},

	/** 统一接收服务端脱敏读模型；页面不保存 provider 患者号。 */
	setPatientsFromPayload(patients: Array<Patient>): void {
		// 空目录只清空当前页面的展示上下文，不删除本地已选 ID。否则 provider
		// 短暂空响应恢复后，解析器会把用户误当作“从未选择”，自动切换到第一位。
		// 会话失效和明确清理仍由 clearPatientContext 负责。
		const resolution = resolveStoredPatientSelection(patients);
		const selectedPatient = resolution.patient ?? null;
		const selectedPatientId =
			typeof selectedPatient?.id === "string" ? selectedPatient.id : "";
		this.setData({
			patients,
			selectedPatientId,
			selectedPatient,
			hasPatients: patients.length > 0,
			error: patientSelectionResolutionMessage(resolution),
		});
	},
});
