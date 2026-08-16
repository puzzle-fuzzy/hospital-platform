import { ApiError, safeApiErrorMessage } from "../../services/api-client";
import {
	loadHealth,
	loadPatients,
	syncPatientsFromHospital,
} from "../../services/dashboard-service";
import {
	getPageLatestRequestGuard,
	getPageSingleFlight,
} from "../../services/page-instance-state";
import {
	clearSelectedPatientId,
	getSelectedPatientId,
	resolveStoredPatientSelection,
	setSelectedPatientId,
} from "../../services/patient-selection-service";
import {
	hasPlatformSession,
	restorePlatformSession,
	signInPlatformSession,
} from "../../services/session-service";
import type {
	ActionEvent,
	IndexEvent,
	IndexPageData,
	Patient,
	PatientEvent,
	ServiceTab,
	SessionLabel,
	TabBarItem,
	TopTabItem,
} from "../../types";

/** 页面显示状态集中定义，避免业务代码散落中文状态常量。 */
const SESSION_LABELS = Object.freeze({
	signedOut: "未登录",
	restoring: "验证会话中",
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

/** 旧端底部四 Tab 的图标与文案；其它 Tab 等待对应页面迁移后再开放跳转。 */
const TAB_BAR_ITEMS = Object.freeze([
	{
		activeIcon: "/assets/legacy-home/tab-01-active.png",
		icon: "/assets/legacy-home/tab-01.png",
		text: "医疗服务",
	},
	{
		activeIcon: "/assets/legacy-home/tab-02-active.png",
		icon: "/assets/legacy-home/tab-02.png",
		text: "就诊",
	},
	{
		activeIcon: "/assets/legacy-home/tab-03-active.png",
		icon: "/assets/legacy-home/tab-03.png",
		text: "互联网医院",
	},
	{
		activeIcon: "/assets/legacy-home/tab-04-active.png",
		icon: "/assets/legacy-home/tab-04.png",
		text: "我的",
	},
] satisfies ReadonlyArray<TabBarItem>);

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
	onLogin(): void;
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
	onSyncPatients(): Promise<Array<Patient>>;
	onLoadAppointments(): void;
	onRefresh(): Promise<void>;
	onPullDownRefresh(): void;
	onLoadReports(): void;
	onLoadAppointmentRecords(): void;
	onSelectPatient(event: PatientEvent): void;
	showError(error: unknown, fallback: string): void;
	setPatientsFromPayload(patients: Array<Patient>): void;
};

/**
 * 首页可能同时发生会话恢复、下拉刷新和目录同步。各类 guard 使用固定
 * key 存在页面实例的 WeakMap 中：同一首页实例内后发的同步会淘汰旧读取，
 * 但不会影响页面栈中的另一个首页实例。
 *
 * 同一首页实例内的患者同步采用单飞语义：自动恢复、用户点击和下拉刷新
 * 可能在同一时间到达，但只能让一个同步请求进入 provider。这个客户端锁
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
		tabBarItems: TAB_BAR_ITEMS,
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

		this.setData({ sessionStatus: SESSION_LABELS.restoring });
		restorePlatformSession()
			.then(() => {
				this.setData({ sessionStatus: SESSION_LABELS.restored });
				return this.loadPatients();
			})
			.then(() => {
				// 恢复旧会话后也要重建一次临床患者映射；仅读取旧目录数据会让预约、报告
				// 和门诊费用继续使用过期的上游映射，导致“患者信息不存在”。
				return this.onSyncPatients();
			})
			.catch((error) => this.showError(error, "会话恢复失败"));
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
				patients: [],
				selectedPatient: null,
				selectedPatientId: "",
				hasPatients: false,
			});
			return;
		}

		this.loadPatients().catch((error) =>
			this.showError(error, "就诊人刷新失败"),
		);
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

	onLogin() {
		this.setData({ loading: true, error: "" });
		signInPlatformSession()
			.then(() => {
				this.setData({ sessionStatus: SESSION_LABELS.signedIn });
				// wx.login 是静默的 code 交换；用成功提示让用户知道平台会话已建立，
				// 不额外索取与医疗业务无关的头像和昵称权限。
				wx.showToast({ title: "微信登录成功", icon: "success" });
				return this.loadPatients();
			})
			.then(() => {
				// 新登录同样主动同步，兼容迁移前已经存在的目录患者记录，并补齐临床映射。
				return this.onSyncPatients();
			})
			.catch((error) => this.showError(error, "登录失败"))
			.finally(() => this.setData({ loading: false }));
	},

	/** 顶部就诊人卡片的主动作：未登录先登录，已有患者进入独立选择页。 */
	onHeroAction() {
		if (!this.data.hasPatients) {
			if (hasPlatformSession()) {
				this.onSyncPatients();
			} else {
				this.onLogin();
			}
			return;
		}
		this.openPatientSelector();
	},

	/** 统一通过页面路由进入患者管理，恢复旧端可浏览、可返回的交互。 */
	openPatientSelector(): void {
		wx.navigateTo({ url: "/pages/patient-select/patient-select" });
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
				wx.navigateTo({ url: "/pages/outpatient-payment/outpatient-payment" });
				break;
			case "hospital-list":
				// 保留旧首页实际跳转的 hospitalList；动态机构和外部互联网医院仍未开放。
				wx.navigateTo({ url: "/pages/hospital-list/hospital-list" });
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
		return loadPatients().then((patients) => {
			if (patientDataGuard.isCurrent(requestToken)) {
				this.setPatientsFromPayload(patients);
			}
			return patients;
		});
	},

	onSyncPatients(): Promise<Array<Patient>> {
		const patientSyncFlight = getPageSingleFlight<Array<Patient>>(
			this,
			"patient-sync",
		);
		return patientSyncFlight.run(() => {
			const patientDataGuard = getPageLatestRequestGuard(this, "patients");
			const syncLoadingGuard = getPageLatestRequestGuard(this, "sync-loading");
			const requestToken = patientDataGuard.begin();
			const loadingToken = syncLoadingGuard.begin();
			this.setData({ syncingPatients: true, error: "" });
			return syncPatientsFromHospital(`patient-sync-${Date.now()}`)
				.then((patients) => {
					if (!patientDataGuard.isCurrent(requestToken)) return patients;
					this.setPatientsFromPayload(patients);
					if (patients.length === 0) {
						this.showError(
							new ApiError("当前微信账号暂无绑定的就诊人", {
								code: "patient-not-bound",
							}),
							"就诊人同步失败",
						);
					}
					return patients;
				})
				.catch((error) => {
					if (patientDataGuard.isCurrent(requestToken)) {
						this.showError(error, "就诊人同步失败");
					}
					return [];
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
			this.onLogin();
			return;
		}
		// 旧端预约流程先确认医院/院区，再进入科室与排班目录。医院列表目前是
		// 单院区静态配置页，不把未确认的机构接口或路线字段混入新的预约 contract。
		wx.navigateTo({ url: "/pages/hospital-list/hospital-list" });
	},

	onRefresh(): Promise<void> {
		// 下拉刷新结束必须等待健康检查和患者目录读取都完成；否则用户看到的
		// “刷新完成”并不代表当前患者上下文已经更新，后续业务页可能读到旧映射。
		const patientRefresh = hasPlatformSession()
			? this.loadPatients().catch((error) => {
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

	onLoadReports() {
		if (!hasPlatformSession()) {
			this.onLogin();
			return;
		}
		// 报告查询拥有独立的患者上下文和空态，不能在首页后台请求后丢失展示结果。
		wx.navigateTo({ url: "/pages/report-directory/report-directory" });
	},

	onLoadAppointmentRecords() {
		if (!hasPlatformSession()) {
			this.onLogin();
			return;
		}
		wx.navigateTo({
			url: "/pages/appointment-records/appointment-records",
		});
	},

	/** 切换患者时清空首页不再持有的报告状态，选择页负责新的患者上下文。 */
	onSelectPatient(event: PatientEvent): void {
		const patientId = event.currentTarget?.dataset?.patientId;
		if (typeof patientId !== "string" || !patientId) return;
		const selectedPatient = this.data.patients.find(
			(patient) => patient.id === patientId,
		);
		if (!selectedPatient) return;

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
			} else if (error.code === "patient-selection-required") {
				message = "当前微信账号暂无已选择的就诊人，请先点击“新增就诊人”";
			} else if (error.code === "patient-not-bound") {
				message = "当前微信账号暂无绑定的就诊人";
			} else {
				message = safeApiErrorMessage(error, fallback);
			}
		}
		this.setData({ error: message });
	},

	/** 统一接收服务端脱敏读模型；页面不保存 provider 患者号。 */
	setPatientsFromPayload(patients: Array<Patient>): void {
		if (patients.length === 0) clearSelectedPatientId();
		const resolution = resolveStoredPatientSelection(patients);
		const selectedPatient = resolution.patient ?? null;
		const selectedPatientId =
			typeof selectedPatient?.id === "string" ? selectedPatient.id : "";
		this.setData({
			patients,
			selectedPatientId,
			selectedPatient,
			hasPatients: patients.length > 0,
			error:
				resolution.state === "stale"
					? "上次选择的就诊人已不可用，请重新选择就诊人"
					: "",
		});
	},
});
