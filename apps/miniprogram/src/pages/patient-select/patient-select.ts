import { ApiError } from "../../services/api-client";
import {
	loadPatients,
	syncPatientsFromHospital,
} from "../../services/dashboard-service";
import {
	getSelectedPatientId,
	setSelectedPatientId,
} from "../../services/patient-selection-service";
import type {
	Patient,
	PatientEvent,
	PatientSelectionPageData,
} from "../../types";

type PatientSelectionPageMethods = {
	loadPatientList(): Promise<void>;
	onPatientTap(event: PatientEvent): void;
	onSyncPatients(): void;
	onPullDownRefresh(): void;
	showError(error: unknown, fallback: string): void;
	setPatientList(patients: Array<Patient>): void;
};

Page<PatientSelectionPageData, PatientSelectionPageMethods>({
	data: {
		patients: [],
		selectedPatientId: "",
		loading: true,
		syncing: false,
		error: "",
	},

	onLoad() {
		this.setData({ selectedPatientId: getSelectedPatientId() });
		this.loadPatientList();
	},

	/** 进入页面后只读取平台患者目录；首次没有目录时再由用户明确触发同步。 */
	loadPatientList(): Promise<void> {
		this.setData({ loading: true, error: "" });
		return loadPatients()
			.then((patients) => this.setPatientList(patients))
			.catch((error) => this.showError(error, "就诊人加载失败"))
			.finally(() => this.setData({ loading: false }));
	},

	/** 将服务端列表与本地选择合并；失效的本地选择回退到列表第一项。 */
	setPatientList(patients: Array<Patient>): void {
		const storedPatientId = getSelectedPatientId();
		const selectedPatient =
			patients.find((patient) => patient.id === storedPatientId) ?? patients[0];
		const selectedPatientId = selectedPatient?.id ?? "";
		if (selectedPatientId && selectedPatientId !== storedPatientId) {
			setSelectedPatientId(selectedPatientId);
		}
		this.setData({ patients, selectedPatientId, error: "" });
	},

	/** 选择完成后只写入 opaque patientId，再返回调用页触发 onShow 刷新。 */
	onPatientTap(event: PatientEvent): void {
		const patientId = event.currentTarget?.dataset?.patientId;
		if (typeof patientId !== "string" || !patientId) return;
		const patient = this.data.patients.find((item) => item.id === patientId);
		if (!patient) return;

		setSelectedPatientId(patient.id);
		wx.showToast({ title: "已切换就诊人", icon: "success" });
		setTimeout(() => wx.navigateBack(), 350);
	},

	/** 从已认证会话重新同步医院目录，不在小程序端拼接身份证或 provider 参数。 */
	onSyncPatients(): void {
		this.setData({ syncing: true, error: "" });
		syncPatientsFromHospital(`patient-selection-sync-${Date.now()}`)
			.then((patients) => {
				this.setPatientList(patients);
				if (patients.length === 0) {
					this.showError(
						new ApiError("当前微信账号暂无绑定的就诊人", {
							code: "patient-not-bound",
						}),
						"就诊人同步失败",
					);
				}
			})
			.catch((error) => this.showError(error, "就诊人同步失败"))
			.finally(() => this.setData({ syncing: false }));
	},

	onPullDownRefresh(): void {
		this.loadPatientList().finally(() => wx.stopPullDownRefresh());
	},

	showError(error: unknown, fallback: string): void {
		let message = fallback;
		if (error instanceof ApiError) {
			if (error.code === "dependency-not-configured") {
				message = "就诊人服务暂未配置完成，请联系管理员";
			} else if (error.code === "patient-not-bound") {
				message = "当前微信账号暂无绑定的就诊人";
			} else {
				message = error.message;
			}
		}
		this.setData({ error: message });
	},
});
