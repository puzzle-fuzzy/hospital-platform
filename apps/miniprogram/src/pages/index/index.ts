import { ApiError } from "../../services/api-client";
import {
	loadAppointmentDirectory,
	loadAppointmentRecords,
	loadHealth,
	loadPatients,
	loadReports,
	syncPatientsFromHospital,
} from "../../services/dashboard-service";
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
	ReportEvent,
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

/** 顶部四项沿用旧端的顺序、图标尺寸和文案；动作仅接入当前已开放的安全读接口。 */
const TOP_TAB_LIST = Object.freeze([
	{
		action: "appointments",
		icon: "/assets/legacy-home/top-registration.svg",
		text: "预约挂号",
	},
	{
		icon: "/assets/legacy-home/top-payment.svg",
		text: "门诊缴费",
	},
	{
		icon: "/assets/legacy-home/top-internet.svg",
		text: "互联网医院",
	},
	{
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
				action: "sync",
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
	checkHealth(): void;
	onLogin(): void;
	onHeroAction(): void;
	onPatientQr(): void;
	onTopAction(event: ActionEvent): void;
	onRightAction(event: ActionEvent): void;
	onTabBarAction(event: IndexEvent): void;
	onFloatingGuide(): void;
	executeQuickAction(action?: string): void;
	onServiceTabChange(event: IndexEvent): void;
	onServiceItemTap(event: ActionEvent): void;
	loadPatients(): Promise<void>;
	onSyncPatients(): void;
	onLoadAppointments(): void;
	onRefresh(): void;
	onPullDownRefresh(): void;
	onLoadReports(): void;
	onLoadAppointmentRecords(): void;
	onSelectReport(event: ReportEvent): void;
	onSelectPatient(event: PatientEvent): void;
	showError(error: unknown, fallback: string): void;
	setPatientsFromPayload(patients: Array<Patient>): void;
	getSelectedPatient(): Patient | undefined;
};

Page<IndexPageData, IndexPageMethods>({
	/** @type {{status: string, service: string, sessionStatus: string, topTabList: ReadonlyArray<Record<string, unknown>>, bannerList: ReadonlyArray<Record<string, string>>, rightList: ReadonlyArray<Record<string, string>>, tabBarItems: ReadonlyArray<Record<string, string>>, serviceTabs: ReadonlyArray<Record<string, unknown>>, activeServiceTab: number, activeServiceItems: ReadonlyArray<Record<string, unknown>>, patients: Array<Record<string, unknown>>, selectedPatient: Record<string, unknown> | null, selectedPatientId: string, hasPatients: boolean, loading: boolean, syncingPatients: boolean, appointmentDepartments: Array<Record<string, unknown>>, appointmentSchedules: Array<Record<string, unknown>>, hasAppointmentData: boolean, loadingAppointments: boolean, appointmentRecords: Array<Record<string, unknown>>, hasAppointmentRecords: boolean, loadingAppointmentRecords: boolean, reports: Array<Record<string, unknown>>, hasReports: boolean, loadingReports: boolean, error: string}} */
	data: {
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
		appointmentDepartments: [],
		appointmentSchedules: [],
		hasAppointmentData: false,
		loadingAppointments: false,
		appointmentRecords: [],
		hasAppointmentRecords: false,
		loadingAppointmentRecords: false,
		reports: [],
		// 报告目录尚未加载时不展示数量，避免使用虚假的默认值。
		reportCount: 0,
		hasReports: false,
		loadingReports: false,
		error: "",
	},

	onLoad() {
		this.checkHealth();
		if (!hasPlatformSession()) return;

		this.setData({ sessionStatus: SESSION_LABELS.restoring });
		restorePlatformSession()
			.then(() => {
				this.setData({ sessionStatus: SESSION_LABELS.restored });
				return this.loadPatients();
			})
			.catch((error) => this.showError(error, "会话恢复失败"));
	},

	checkHealth() {
		loadHealth()
			.then((payload) =>
				this.setData({
					status: payload.data.status,
					service: payload.data.service,
					error: "",
				}),
			)
			.catch((error) => this.showError(error, "服务不可用"));
	},

	onLogin() {
		this.setData({ loading: true, error: "" });
		signInPlatformSession()
			.then(() => {
				this.setData({ sessionStatus: SESSION_LABELS.signedIn });
				return this.loadPatients();
			})
			.catch((error) => this.showError(error, "登录失败"))
			.finally(() => this.setData({ loading: false }));
	},

	/** 顶部就诊人卡片的主动作：未登录先登录，已有患者则执行服务端同步。 */
	onHeroAction() {
		if (!this.data.hasPatients) {
			this.onLogin();
			return;
		}
		if (this.data.patients.length < 2) {
			this.onSyncPatients();
			return;
		}
		wx.showActionSheet({
			itemList: this.data.patients.map((patient) =>
				String(patient.displayName || "就诊人"),
			),
			success: ({ tapIndex }) => {
				const patient = this.data.patients[tapIndex];
				if (typeof patient?.id !== "string") return;
				this.onSelectPatient({
					currentTarget: { dataset: { patientId: patient.id } },
				});
			},
		});
	},

	/** 原首页二维码入口保留位置；二维码生成能力未接入时不伪造外部 QR 地址。 */
	onPatientQr() {
		wx.showToast({
			title: this.data.selectedPatientId ? "二维码功能迁移中" : "暂无就诊人",
			icon: "none",
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
		wx.showToast({ title: "该页面正在迁移中", icon: "none" });
	},

	onFloatingGuide() {
		wx.showToast({ title: "智能客服功能迁移中", icon: "none" });
	},

	executeQuickAction(action?: string): void {
		switch (action) {
			case "sync":
				this.onSyncPatients();
				break;
			case "appointments":
				this.onLoadAppointments();
				break;
			case "appointment-records":
				this.onLoadAppointmentRecords();
				break;
			case "reports":
				this.onLoadReports();
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

	loadPatients(): Promise<void> {
		return loadPatients()
			.then((patients) => this.setPatientsFromPayload(patients))
			.catch((error) => this.showError(error, "就诊人加载失败"));
	},

	onSyncPatients() {
		this.setData({ syncingPatients: true, error: "" });
		syncPatientsFromHospital(`patient-sync-${Date.now()}`)
			.then((patients) => this.setPatientsFromPayload(patients))
			.catch((error) => this.showError(error, "就诊人同步失败"))
			.finally(() => this.setData({ syncingPatients: false }));
	},

	onLoadAppointments() {
		this.setData({ loadingAppointments: true, error: "" });
		loadAppointmentDirectory()
			.then(({ departments, schedules }) => {
				this.setData({
					appointmentDepartments: departments,
					appointmentSchedules: schedules,
					hasAppointmentData: departments.length > 0 || schedules.length > 0,
					error: "",
				});
			})
			.catch((error) => this.showError(error, "预约目录加载失败"))
			.finally(() => this.setData({ loadingAppointments: false }));
	},

	onRefresh() {
		this.checkHealth();
		if (hasPlatformSession()) this.loadPatients();
	},

	onPullDownRefresh() {
		this.onRefresh();
		wx.stopPullDownRefresh();
	},

	onLoadReports() {
		const patient = this.getSelectedPatient();
		if (!patient || typeof patient.id !== "string" || !patient.id) {
			this.showError(new ApiError("请先登录并选择就诊人"), "报告加载失败");
			return;
		}
		this.setData({ loadingReports: true, error: "" });
		loadReports(patient.id)
			.then((reports) =>
				this.setData({
					reports: reports.items,
					reportCount: reports.total,
					hasReports: reports.items.length > 0,
					error: "",
				}),
			)
			.catch((error) => this.showError(error, "报告目录加载失败"))
			.finally(() => this.setData({ loadingReports: false }));
	},

	onLoadAppointmentRecords() {
		const patient = this.getSelectedPatient();
		if (!patient || typeof patient.id !== "string" || !patient.id) {
			this.showError(new ApiError("请先登录并选择就诊人"), "预约记录加载失败");
			return;
		}
		this.setData({ loadingAppointmentRecords: true, error: "" });
		loadAppointmentRecords(patient.id)
			.then((appointmentRecords) =>
				this.setData({
					appointmentRecords,
					hasAppointmentRecords: appointmentRecords.length > 0,
					error: "",
				}),
			)
			.catch((error) => this.showError(error, "预约记录加载失败"))
			.finally(() => this.setData({ loadingAppointmentRecords: false }));
	},

	/** 只有服务端生成的 opaque reportId 才能进入详情页。 */
	onSelectReport(event: ReportEvent): void {
		const reportId = event.currentTarget?.dataset?.reportId;
		if (typeof reportId !== "string" || !reportId) {
			this.showError(
				new ApiError("该报告详情暂未开放", {
					code: "report-detail-not-ready",
				}),
				"报告详情加载失败",
			);
			return;
		}

		wx.navigateTo({
			url: `/pages/report-detail/report-detail?reportId=${encodeURIComponent(reportId)}&reportCount=${this.data.reportCount}`,
		});
	},

	/** 切换患者时清空旧患者的报告和预约记录。 */
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
			appointmentRecords: [],
			hasAppointmentRecords: false,
			reports: [],
			reportCount: 0,
			hasReports: false,
			error: "",
		});
	},

	showError(error: unknown, fallback: string): void {
		const message = error instanceof ApiError ? error.message : fallback;
		this.setData({ error: message });
	},

	/** 统一接收服务端脱敏读模型；页面不保存 provider 患者号。 */
	setPatientsFromPayload(patients: Array<Patient>): void {
		const selectedPatient =
			patients.find((patient) => patient.id === this.data.selectedPatientId) ||
			patients[0] ||
			null;
		const selectedPatientId =
			typeof selectedPatient?.id === "string" ? selectedPatient.id : "";
		this.setData({
			patients,
			selectedPatientId,
			selectedPatient,
			hasPatients: patients.length > 0,
			error: "",
		});
	},

	/** 读取当前选择的患者；旧选择失效时自动回退到服务端列表首项。 */
	getSelectedPatient(): Patient | undefined {
		const selected = this.data.patients.find(
			(patient) => patient.id === this.data.selectedPatientId,
		);
		if (selected) return selected;

		const fallback = this.data.patients[0];
		if (fallback && typeof fallback.id === "string") {
			this.setData({
				selectedPatientId: fallback.id,
				selectedPatient: fallback,
			});
		}
		return fallback;
	},
});
