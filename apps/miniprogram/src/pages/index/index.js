import {
	ApiError,
	login,
	request,
	requestWithSession,
	requestAppointmentDepartments,
	requestAppointmentSchedules,
	requestReports,
	syncPatients,
} from "../../services/api-client";

Page({
	/** @type {{status: string, service: string, sessionStatus: string, patients: Array<Record<string, unknown>>, hasPatients: boolean, loading: boolean, syncingPatients: boolean, appointmentDepartments: Array<Record<string, unknown>>, appointmentSchedules: Array<Record<string, unknown>>, hasAppointmentData: boolean, loadingAppointments: boolean, reports: Array<Record<string, unknown>>, hasReports: boolean, loadingReports: boolean, error: string}} */
	data: {
		status: "加载中",
		service: "",
		sessionStatus: "未登录",
		patients: [],
		hasPatients: false,
		loading: false,
		syncingPatients: false,
		appointmentDepartments: [],
		appointmentSchedules: [],
		hasAppointmentData: false,
		loadingAppointments: false,
		reports: [],
		hasReports: false,
		loadingReports: false,
		error: "",
	},

	onLoad() {
		this.checkHealth();
		if (getApp().globalData.accessToken) {
			this.setData({ sessionStatus: "已恢复会话" });
			this.loadPatients();
		}
	},

	checkHealth() {
		request({ url: "/health/live" })
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
		login()
			.then(() => {
				getApp().globalData.sessionStatus = "signed_in";
				this.setData({ sessionStatus: "已登录" });
				return this.loadPatients();
			})
			.catch((error) => this.showError(error, "登录失败"))
			.finally(() => this.setData({ loading: false }));
	},

	loadPatients() {
		return requestWithSession({ url: "/api/v1/patients" })
			.then((payload) => {
				this.setPatientsFromPayload(payload);
			})
			.catch((error) => this.showError(error, "就诊人加载失败"));
	},

	onSyncPatients() {
		this.setData({ syncingPatients: true, error: "" });
		syncPatients(`patient-sync-${Date.now()}`)
			.then((payload) => this.setPatientsFromPayload(payload))
			.catch((error) => this.showError(error, "就诊人同步失败"))
			.finally(() => this.setData({ syncingPatients: false }));
	},

	onLoadAppointments() {
		this.setData({ loadingAppointments: true, error: "" });
		const start = new Date();
		const end = new Date(start.getTime() + 7 * 24 * 60 * 60 * 1000);
		/** @param {Date} value */
		const date = (value) => {
			const year = value.getFullYear();
			const month = String(value.getMonth() + 1).padStart(2, "0");
			const day = String(value.getDate()).padStart(2, "0");
			return `${year}-${month}-${day}`;
		};

		Promise.all([
			requestAppointmentDepartments(),
			requestAppointmentSchedules({
				startDate: date(start),
				endDate: date(end),
			}),
		])
			.then(([departmentPayload, schedulePayload]) => {
				const appointmentDepartments = departmentPayload?.data?.items || [];
				const appointmentSchedules = schedulePayload?.data?.items || [];
				this.setData({
					appointmentDepartments,
					appointmentSchedules,
					hasAppointmentData:
						appointmentDepartments.length > 0 ||
						appointmentSchedules.length > 0,
					error: "",
				});
			})
			.catch((error) => this.showError(error, "预约目录加载失败"))
			.finally(() => this.setData({ loadingAppointments: false }));
	},

	onRefresh() {
		this.checkHealth();
		if (getApp().globalData.accessToken) this.loadPatients();
	},

	onLoadReports() {
		const patient = this.data.patients[0];
		if (!patient || typeof patient.id !== "string" || !patient.id) {
			this.showError(new ApiError("请先登录并同步就诊人"), "报告加载失败");
			return;
		}
		this.setData({ loadingReports: true, error: "" });
		const end = new Date();
		const start = new Date(end.getTime() - 30 * 24 * 60 * 60 * 1000);
		/** @param {Date} value */
		const date = (value) => {
			const year = value.getFullYear();
			const month = String(value.getMonth() + 1).padStart(2, "0");
			const day = String(value.getDate()).padStart(2, "0");
			return `${year}-${month}-${day}`;
		};

		requestReports({
			patientId: patient.id,
			startDate: date(start),
			endDate: date(end),
		})
			.then((payload) => {
				const reports = payload?.data?.items || [];
				this.setData({ reports, hasReports: reports.length > 0, error: "" });
			})
			.catch((error) => this.showError(error, "报告目录加载失败"))
			.finally(() => this.setData({ loadingReports: false }));
	},

	/** @param {unknown} error @param {string} fallback */
	showError(error, fallback) {
		const message = error instanceof ApiError ? error.message : fallback;
		this.setData({ error: message });
	},

	/**
	 * 统一接收服务端脱敏读模型；页面不保存 provider 患者号。
	 * @param {{data?: {items?: Array<Record<string, unknown>>}}} payload
	 */
	setPatientsFromPayload(payload) {
		const patients = payload?.data?.items || [];
		this.setData({ patients, hasPatients: patients.length > 0, error: "" });
	},
});
