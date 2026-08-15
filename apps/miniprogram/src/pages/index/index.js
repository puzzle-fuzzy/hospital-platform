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

/** 页面显示状态集中定义，避免业务代码散落中文状态常量。 */
const SESSION_LABELS = Object.freeze({
	signedOut: "未登录",
	restoring: "验证会话中",
	restored: "已恢复会话",
	signedIn: "已登录",
});

/** @type {WechatMiniprogram.Page.Instance<WechatMiniprogram.IAnyObject, Record<string, unknown>>} */
Page({
	/** @type {{status: string, service: string, sessionStatus: string, patients: Array<Record<string, unknown>>, selectedPatientId: string, hasPatients: boolean, loading: boolean, syncingPatients: boolean, appointmentDepartments: Array<Record<string, unknown>>, appointmentSchedules: Array<Record<string, unknown>>, hasAppointmentData: boolean, loadingAppointments: boolean, appointmentRecords: Array<Record<string, unknown>>, hasAppointmentRecords: boolean, loadingAppointmentRecords: boolean, reports: Array<Record<string, unknown>>, hasReports: boolean, loadingReports: boolean, error: string}} */
	data: {
		status: "加载中",
		service: "",
		sessionStatus: SESSION_LABELS.signedOut,
		patients: [],
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

	loadPatients() {
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

	onLoadReports() {
		const patient = this.getSelectedPatient();
		if (!patient || typeof patient.id !== "string" || !patient.id) {
			this.showError(new ApiError("请先登录并选择就诊人"), "报告加载失败");
			return;
		}
		this.setData({ loadingReports: true, error: "" });
		loadReports(patient.id)
			.then((reports) =>
				this.setData({ reports, hasReports: reports.length > 0, error: "" }),
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

	/**
	 * 只有服务端生成的 opaque reportId 才能进入详情页；没有引用时保持摘要只读。
	 * @param {{currentTarget?: {dataset?: {reportId?: string}}}} event
	 */
	onSelectReport(event) {
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
			url: `/pages/report-detail/report-detail?reportId=${encodeURIComponent(reportId)}`,
		});
	},

	/**
	 * 切换当前业务患者时清空旧患者的报告和预约记录，避免页面把旧数据
	 * 误显示到新选择的 patientId 下。
	 * @param {{currentTarget?: {dataset?: {patientId?: string}}}} event
	 */
	onSelectPatient(event) {
		const patientId = event.currentTarget?.dataset?.patientId;
		if (typeof patientId !== "string" || !patientId) return;
		if (!this.data.patients.some((patient) => patient.id === patientId)) return;

		this.setData({
			selectedPatientId: patientId,
			appointmentRecords: [],
			hasAppointmentRecords: false,
			reports: [],
			hasReports: false,
			error: "",
		});
	},

	/** @param {unknown} error @param {string} fallback */
	showError(error, fallback) {
		const message = error instanceof ApiError ? error.message : fallback;
		this.setData({ error: message });
	},

	/**
	 * 统一接收服务端脱敏读模型；页面不保存 provider 患者号。
	 * @param {Array<Record<string, unknown>>} patients
	 */
	setPatientsFromPayload(patients) {
		const selectedPatientId = patients.some(
			(patient) => patient.id === this.data.selectedPatientId,
		)
			? this.data.selectedPatientId
			: typeof patients[0]?.id === "string"
				? patients[0].id
				: "";
		this.setData({
			patients,
			selectedPatientId,
			hasPatients: patients.length > 0,
			error: "",
		});
	},

	/** 读取当前选择的患者；旧选择失效时自动回退到服务端列表首项。 */
	getSelectedPatient() {
		const selected = this.data.patients.find(
			(patient) => patient.id === this.data.selectedPatientId,
		);
		if (selected) return selected;

		const fallback = this.data.patients[0];
		if (fallback && typeof fallback.id === "string") {
			this.setData({ selectedPatientId: fallback.id });
		}
		return fallback;
	},
});
