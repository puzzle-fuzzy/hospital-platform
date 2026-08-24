import { ApiError } from "../../services/api-client";
import {
	loadHealth,
	loadPatients,
	syncPatientsFromHospital,
} from "../../services/dashboard-service";
import {
	disposePageInstance,
	getPageLatestRequestGuard,
	getPageLifecycle,
	getPageSingleFlight,
} from "../../services/page-instance-state";
import {
	type PatientBootstrapResult,
	type PatientDirectoryLoadResult,
	shouldContinueAfterLogin,
	shouldContinueAfterPatientLoad,
} from "../../services/patient-bootstrap";
import {
	navigateToAuthenticatedPage,
	navigateToPatientScopedPage,
	navigateToPatientSelector,
} from "../../services/patient-navigation";
import {
	clearSelectedPatientId,
	getSelectedPatientId,
	isCurrentSelectedPatient,
	patientContextErrorMessage,
	patientSelectionResolutionMessage,
	resolveStoredPatientSelection,
} from "../../services/patient-selection-service";
import { getSessionGeneration } from "../../services/session-generation";
import {
	hasPlatformSession,
	restorePlatformSession,
	sessionVerificationStateFromError,
	sessionVerificationStateFromLabel,
	signInPlatformSession,
} from "../../services/session-service";
import type {
	ActionEvent,
	IndexEvent,
	IndexPageData,
	Patient,
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
	onFloatingGuide(): void;
	executeQuickAction(action?: string): void;
	onServiceTabChange(event: IndexEvent): void;
	onServiceItemTap(event: ActionEvent): void;
	loadPatients(restoreSelection?: boolean): Promise<PatientDirectoryLoadResult>;
	onSyncPatients(): Promise<Exclude<PatientBootstrapResult, "skipped">>;
	onLoadAppointments(): void;
	onLoadOutpatientPayment(): void;
	onRefresh(): Promise<void>;
	onRetry(): void;
	onPullDownRefresh(): void;
	onUnload(): void;
	onLoadReports(): void;
	onLoadAppointmentRecords(): void;
	showError(error: unknown, fallback: string): void;
	clearDisplayedPatientContext(): void;
	clearPatientContext(): void;
	setPatientsFromPayload(
		patients: Array<Patient>,
		restoreSelection?: boolean,
	): void;
};

type LoginOptions = {
	/** 登录完成并完成必要的首页初始化后，继续用户刚才触发的动作。 */
	afterSuccess?: () => void;
	/** 需要跳转到会自行读取目录的页面时，避免首页重复请求患者同步。 */
	skipPatientBootstrap?: boolean;
	/** 患者范围页面必须等当前轮次确认出患者后才能继续。 */
	requiresPatient?: boolean;
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

		// 本地 token 只能说明“存在一个待验证的会话”，不能证明它仍属于当前
		// principal。恢复 /me 期间先撤销页面上的患者派生数据，避免旧 token
		// 过期、微信 code 兑换失败或 Redis 暂时不可用时继续展示上一位患者。
		// 这里不删除本地 selectedPatientId；恢复成功后仍需按 owner-scoped
		// 目录重新解析，失效选择进入 stale，而不是静默切到第一位患者。
		this.setData({
			// 在一次 setData 中同时撤销旧患者并进入验证态，避免中间帧先出现
			// “匿名/----”再切换到“正在验证”，保证卡片高度和内容状态稳定。
			patients: [],
			selectedPatient: null,
			selectedPatientId: "",
			hasPatients: false,
			sessionStatus: SESSION_LABELS.restoring,
		});
		const sessionGuard = getPageLatestRequestGuard(this, "session");
		const sessionToken = sessionGuard.begin();
		restorePlatformSession()
			.then(() => {
				if (!sessionGuard.isCurrent(sessionToken)) return;
				this.setData({ sessionStatus: SESSION_LABELS.restored });
				// 恢复链的第一次目录读取只确认当前 owner 能读到目录；本轮
				// 临床映射尚未同步完成前，不能把旧目录里的患者画成首页当前患者。
				return this.loadPatients(false);
			})
			.then((patientLoadResult) => {
				if (
					patientLoadResult === undefined ||
					!sessionGuard.isCurrent(sessionToken) ||
					!shouldContinueAfterPatientLoad(patientLoadResult)
				) {
					return;
				}
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
			// 会话失效时不继续展示上一位患者；重新登录后由 owner-scoped
			// 目录读取恢复。这里不能删除用户已经明确选择的 opaque ID：
			// 同一微信账号只是 token 过期时，应恢复原患者；如果账号已经
			// 变化，目录解析会进入 stale，要求显式重选，不能静默切第一位。
			this.clearDisplayedPatientContext();
			this.setData({
				sessionStatus: SESSION_LABELS.signedOut,
			});
			return;
		}

		// onShow 可能发生在其他页面收到 401 但全局 token 尚未清理、或 token
		// 即将被 requestWithSession 自动轮换的窗口内。目录请求完成前不能沿用
		// 旧卡片；否则页面会同时出现“旧患者 + 新会话验证中”的不一致快照。
		const sessionGuard = getPageLatestRequestGuard(this, "session");
		const sessionToken = sessionGuard.begin();
		this.setData({
			// 和首次恢复一样，在同一次更新中撤销旧患者并进入验证态；否则
			// 共享 Tab 切回首页时会先绘制一帧空卡片，再绘制加载状态。
			patients: [],
			selectedPatient: null,
			selectedPatientId: "",
			hasPatients: false,
			sessionStatus: SESSION_LABELS.restoring,
			error: "",
		});
		const pageLifecycle = getPageLifecycle(this);
		this.loadPatients()
			.then((patientLoadResult) => {
				if (
					!sessionGuard.isCurrent(sessionToken) ||
					!pageLifecycle.isActive() ||
					!shouldContinueAfterPatientLoad(patientLoadResult)
				)
					return;
				// /patients 成功表示当前 token 已被服务端接受；如果请求期间
				// 发生 401，requestWithSession 已完成一次受控微信登录后才会到达这里。
				// `superseded` 只表示本轮读取被更新的目录周期淘汰，不能把它
				// 当成“会话已恢复”；真正的最新读取由它自己的调用方负责收敛状态。
				this.setData({ sessionStatus: SESSION_LABELS.restored });
			})
			.catch((error) => {
				if (!sessionGuard.isCurrent(sessionToken) || !pageLifecycle.isActive())
					return;
				this.clearDisplayedPatientContext();
				this.setData({
					sessionStatus:
						sessionVerificationStateFromError(error) === "invalid" ||
						!hasPlatformSession()
							? SESSION_LABELS.signedOut
							: SESSION_LABELS.unavailable,
				});
				this.showError(error, "就诊人刷新失败");
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
		// 这里只清理展示态，不删除用户的本地显式选择；登录到同一账号时
		// 可以恢复原患者，登录到其他账号时则由 owner-scoped 目录进入 stale。
		if (!hasPlatformSession()) this.clearDisplayedPatientContext();
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
				if (options.skipPatientBootstrap) return "skipped" as const;
				// 登录后的第一次目录读取同样只是同步前置检查；等医院侧映射
				// 成功后，下面的 onSyncPatients 才允许恢复 selectedPatient。
				return this.loadPatients(false).then((patientLoadResult) => {
					if (!shouldContinueAfterPatientLoad(patientLoadResult)) {
						return "superseded" as const;
					}
					return this.onSyncPatients();
				});
			})
			.then((bootstrapResult: PatientBootstrapResult | undefined) => {
				if (!sessionGuard.isCurrent(sessionToken)) return;
				if (
					!bootstrapResult ||
					!shouldContinueAfterLogin(
						bootstrapResult,
						options.requiresPatient ?? false,
						Boolean(this.data.selectedPatient),
					)
				)
					return;
				// 只有首页初始化结果明确允许时，才重放用户刚才点击的动作。
				// 同步失败不会冒充成功；患者为空时也不能进入患者范围页面。
				return options.afterSuccess?.();
			})
			.catch((error) => {
				if (!sessionGuard.isCurrent(sessionToken)) return;
				// 登录失败不能留下“有患者但无会话”的半登录状态；只有确认
				// 没有本地 token 才清理页面展示。不能在这里删除本地选择：
				// token 失效可能只是同一账号的临时会话故障，下一轮 owner-scoped
				// 目录读取仍需把用户原来的选择解析成 selected/stale，而非默认换人。
				if (!hasPlatformSession()) {
					this.clearDisplayedPatientContext();
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
	 * 旧端注释曾声称二维码包含医院临床患者引用，但实际代码读取的是医疗卡号字段，
	 * 并交给第三方二维码服务生成图片。当前没有医院扫码协议，因此只给出明确
	 * 迁移状态，不复制卡号外发行为，也不生成未经签名和有效期保护的伪二维码。
	 */
	onPatientQr() {
		// 本地 opaque patientId 只能用于恢复/stale 判断，不能证明当前页面已经
		// 取得同一会话的最新患者目录。二维码入口必须同时确认页面对象、storage
		// 中的显式选择和临床映射状态；否则临时故障、账号切换或旧页面停留期间，
		// 仍会把“有缓存 ID”误报成“有患者可扫码”。虽然二维码当前仍是关闭态，
		// 这里先把未来开放时必须满足的患者上下文门禁固定在当前实现中。
		const selectedPatient = this.data.selectedPatient;
		const hasConfirmedPatient = Boolean(
			selectedPatient &&
				selectedPatient.clinicalAccess === "ready" &&
				isCurrentSelectedPatient(selectedPatient.id),
		);
		wx.showModal({
			title: hasConfirmedPatient ? "二维码暂未开放" : "暂无就诊人",
			content: hasConfirmedPatient
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

	loadPatients(restoreSelection = true): Promise<PatientDirectoryLoadResult> {
		const patientDataGuard = getPageLatestRequestGuard(this, "patients");
		const requestToken = patientDataGuard.begin();
		return loadPatients()
			.then((patients) => {
				if (!patientDataGuard.isCurrent(requestToken)) {
					// 成功响应也可能在回调执行前被新一轮读取淘汰；不能因为
					// Provider 返回了 200，就把没有资格写入页面的旧快照当成
					// 当前目录读取成功，更不能让登录链继续启动患者同步。
					return "superseded" as const;
				}
				this.setPatientsFromPayload(patients, restoreSelection);
				return "loaded" as const;
			})
			.catch((error) => {
				if (!patientDataGuard.isCurrent(requestToken)) {
					// 新一轮目录读取或页面卸载已经取消了本次请求；旧错误不能再
					// 冒泡给 onShow/onRefresh，否则外层回调可能清空新请求的结果，
					// 或在页面销毁后继续 setData。这里必须返回显式的
					// `superseded`，不能返回 []：上层登录恢复链需要据此阻止
					// 后续患者同步，避免把取消误当成成功空目录。
					return "superseded" as const;
				}
				// 目录读取失败时，当前首页的患者卡片不再具有最新 owner-scoped
				// 证据；清理展示状态但保留本地 opaque 选择，便于下一次恢复。
				this.clearDisplayedPatientContext();
				throw error;
			});
	},

	/**
	 * 首页同步只返回“同步流程结果”，不向调用方返回患者快照。
	 *
	 * 成功的空目录和失败兜底都可能表现为数组长度为 0；如果这里返回
	 * `[]`，后续调用方就无法区分“医院确认没有就诊人”和“同步失败”。
	 * 患者快照只允许通过页面状态和服务端成功响应进入展示，失败则由本页
	 * 清理展示上下文并保留可重试的会话，避免把错误伪装成业务空结果。
	 */
	onSyncPatients(): Promise<Exclude<PatientBootstrapResult, "skipped">> {
		const patientSyncFlight = getPageSingleFlight<
			Exclude<PatientBootstrapResult, "skipped">
		>(this, `patient-sync:${getSessionGeneration()}`);
		return patientSyncFlight.run(() => {
			const patientDataGuard = getPageLatestRequestGuard(this, "patients");
			const syncLoadingGuard = getPageLatestRequestGuard(this, "sync-loading");
			const requestToken = patientDataGuard.begin();
			const loadingToken = syncLoadingGuard.begin();
			// 同步在途期间旧患者尚未得到本轮临床映射确认，不能继续作为
			// 预约、报告和门诊费用的业务上下文。这里只清理首页展示态，
			// 不删除本地显式选择，成功后仍由 resolveStoredPatientSelection 恢复。
			this.clearDisplayedPatientContext();
			this.setData({ syncingPatients: true, error: "" });
			return syncPatientsFromHospital("patient-sync")
				.then((patients) => {
					if (!patientDataGuard.isCurrent(requestToken))
						return "superseded" as const;
					// setPatientsFromPayload 已经按本地显式选择解析 empty/stale/
					// unavailable。这里不能再用数组长度覆盖解析结果，否则“已有
					// 患者但最新目录为空”会被错误降级成“从未绑定患者”。
					this.setPatientsFromPayload(patients);
					return "succeeded" as const;
				})
				.catch((error) => {
					if (patientDataGuard.isCurrent(requestToken)) {
						// 临床映射同步失败时，旧卡片也不能继续作为可用患者上下文；
						// 本地选择和会话 token 仍保留，等待用户重试恢复。
						this.clearDisplayedPatientContext();
						this.showError(error, "就诊人同步失败");
					}
					return patientDataGuard.isCurrent(requestToken)
						? ("failed" as const)
						: ("superseded" as const);
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
		const pageLifecycle = getPageLifecycle(this);
		const sessionAvailable = hasPlatformSession();
		const sessionGuard = sessionAvailable
			? getPageLatestRequestGuard(this, "session")
			: undefined;
		const sessionToken = sessionGuard?.begin();
		if (sessionAvailable) {
			// 下拉刷新本身也是一次会话验证周期；它可能淘汰 onShow 的旧
			// 目录读取，因此必须由自己的最新周期负责恢复入口状态。
			this.setData({ sessionStatus: SESSION_LABELS.restoring });
		}
		const patientRefresh = sessionAvailable
			? this.loadPatients()
					.then((patientLoadResult) => {
						if (
							!sessionGuard ||
							sessionToken === undefined ||
							!sessionGuard.isCurrent(sessionToken) ||
							!pageLifecycle.isActive() ||
							!shouldContinueAfterPatientLoad(patientLoadResult)
						)
							return;
						// 只有当前刷新周期真正提交了目录，才能把首页从“验证中”
						// 收敛为“已恢复”；被淘汰的旧周期不能伪造成功。
						this.setData({ sessionStatus: SESSION_LABELS.restored });
					})
					.catch((error) => {
						if (
							!sessionGuard ||
							sessionToken === undefined ||
							!sessionGuard.isCurrent(sessionToken) ||
							!pageLifecycle.isActive()
						)
							return;
						this.setData({
							sessionStatus:
								sessionVerificationStateFromError(error) === "invalid" ||
								!hasPlatformSession()
									? SESSION_LABELS.signedOut
									: SESSION_LABELS.unavailable,
						});
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

	/**
	 * 首页顶部错误条的显式恢复入口。
	 *
	 * 首页错误可能只来自健康检查，也可能来自已登录会话的患者目录；
	 * 统一复用现有刷新编排，避免另起一条会绕过请求代际和会话守卫的
	 * “重试”路径。未登录时仍由首页原有登录入口负责建立微信会话，
	 * 这里只重试当前页面已经展示的可恢复请求。
	 */
	onRetry(): void {
		if (this.data.loading || this.data.syncingPatients) return;
		void this.onRefresh();
	},

	/** 页面卸载后让首页的健康、患者目录和同步请求失去回写资格。 */
	onUnload(): void {
		disposePageInstance(this);
	},

	onLoadReports() {
		if (!hasPlatformSession()) {
			this.onLogin({
				afterSuccess: () => this.onLoadReports(),
				requiresPatient: true,
			});
			return;
		}
		// 报告查询拥有独立的患者上下文和空态，不能在首页后台请求后丢失展示结果。
		navigateToPatientScopedPage(
			"/pages/report-directory/report-directory",
			sessionVerificationStateFromLabel(this.data.sessionStatus),
			this.data.selectedPatient,
		);
	},

	onLoadAppointmentRecords() {
		if (!hasPlatformSession()) {
			this.onLogin({
				afterSuccess: () => this.onLoadAppointmentRecords(),
				requiresPatient: true,
			});
			return;
		}
		navigateToPatientScopedPage(
			"/pages/appointment-records/appointment-records",
			sessionVerificationStateFromLabel(this.data.sessionStatus),
			this.data.selectedPatient,
		);
	},

	/** 门诊费用与预约历史一样必须绑定临床患者，不能先打开再由 API 返回 401。 */
	onLoadOutpatientPayment() {
		if (!hasPlatformSession()) {
			this.onLogin({
				afterSuccess: () => this.onLoadOutpatientPayment(),
				requiresPatient: true,
			});
			return;
		}
		navigateToPatientScopedPage(
			"/pages/outpatient-payment/outpatient-payment",
			sessionVerificationStateFromLabel(this.data.sessionStatus),
			this.data.selectedPatient,
		);
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
	setPatientsFromPayload(
		patients: Array<Patient>,
		restoreSelection = true,
	): void {
		if (!restoreSelection) {
			// bootstrap 的预同步读取只证明平台目录可读，不能证明本轮
			// his-patient 映射已经完成。保留列表数量供页面状态使用，但
			// 不恢复 selectedPatient / selectedPatientId；后续同步成功时
			// 会再次调用本方法并完成 owner-scoped 选择解析。
			this.setData({
				patients,
				selectedPatientId: "",
				selectedPatient: null,
				hasPatients: patients.length > 0,
				error: "",
			});
			return;
		}
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
