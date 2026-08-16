import { ApiError, safeApiErrorMessage } from "../../services/api-client";
import {
	loadPatients,
	syncPatientsFromHospital,
} from "../../services/dashboard-service";
import { createLatestRequestGuard } from "../../services/latest-request-guard";
import {
	clearSelectedPatientId,
	getSelectedPatientId,
	resolveStoredPatientSelection,
	setSelectedPatientId,
} from "../../services/patient-selection-service";
import type {
	Patient,
	PatientEvent,
	PatientSelectionPageData,
	PatientSelectionView,
} from "../../types";

type PatientSelectionPageMethods = {
	loadPatientList(): Promise<void>;
	onPatientTap(event: PatientEvent): void;
	onAddPatient(): void;
	onSyncPatients(): Promise<void>;
	onPullDownRefresh(): void;
	showError(error: unknown, fallback: string): void;
	setPatientList(patients: Array<Patient>): void;
};

/** provider 关系值是稳定枚举，中文文案由小程序展示层维护。 */
const PATIENT_RELATIONSHIP_LABELS: Record<Patient["relationship"], string> = {
	self: "本人",
	spouse: "配偶",
	child: "子女",
	parent: "父母",
	/** provider 未声明可识别关系时显示“其他”，不代表患者信息异常。 */
	other: "其他",
};

/**
 * 目录数据和 loading 展示分别维护序号：刷新必须淘汰旧目录响应，
 * 但旧读取不能阻止当前刷新正确结束 loading 状态。
 */
const directoryDataGuard = createLatestRequestGuard();
const loadingGuard = createLatestRequestGuard();
const syncGuard = createLatestRequestGuard();
/**
 * 自动同步和用户手动刷新可能同时触发；同一页面只允许一个同步请求进入 provider。
 * 服务端仍以 owner + Idempotency-Key 做最终幂等，这里是防止真机重复事件的第一层保护。
 */
let patientSyncInFlight: Promise<void> | undefined;

function toPatientSelectionView(patient: Patient): PatientSelectionView {
	return {
		...patient,
		relationshipLabel: PATIENT_RELATIONSHIP_LABELS[patient.relationship],
	};
}

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

	/** 进入页面先读取平台目录，再主动同步一次临床映射，保证直接打开选择页也可用。 */
	loadPatientList(): Promise<void> {
		const dataToken = directoryDataGuard.begin();
		const loadingToken = loadingGuard.begin();
		this.setData({ loading: true, error: "" });
		return loadPatients()
			.then((patients) => {
				if (!directoryDataGuard.isCurrent(dataToken)) return;
				this.setPatientList(patients);
				// 选择页也可能被历史路径直接打开，不能依赖首页先完成临床映射；
				// 无论本地是否已有目录记录，都主动同步一次，确保首次登录也能得到临床映射。
				// 选择页的目录读取完成后还必须等待一次完整同步；否则下拉刷新会
				// 提前结束，调用页可能在 HIS 映射尚未落库时开始预约/报告查询。
				// loading 由外层 finally 统一关闭，不能在这里提前置 false。
				return this.onSyncPatients();
			})
			.catch((error) => {
				if (
					directoryDataGuard.isCurrent(dataToken) &&
					loadingGuard.isCurrent(loadingToken)
				) {
					this.showError(error, "就诊人加载失败");
				}
			})
			.finally(() => {
				if (loadingGuard.isCurrent(loadingToken)) {
					this.setData({ loading: false });
				}
			});
	},

	/**
	 * 将服务端列表与本地选择合并。
	 *
	 * 首次没有历史选择时默认第一位；已有选择失效时不自动换人，页面保持无选中
	 * 状态，要求用户明确点击新的就诊人。
	 */
	setPatientList(patients: Array<Patient>): void {
		if (patients.length === 0) clearSelectedPatientId();
		const resolution = resolveStoredPatientSelection(patients);
		const selectedPatientId = resolution.patient?.id ?? "";
		this.setData({
			patients: patients.map(toPatientSelectionView),
			selectedPatientId,
			error:
				resolution.state === "stale"
					? "上次选择的就诊人已失效，请重新选择"
					: "",
		});
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

	/** 绑定写入接口尚未通过真实医院契约验收，先明确提示而不是伪造成功。 */
	onAddPatient(): void {
		wx.showModal({
			title: "添加就诊人",
			content: "医院绑定接口正在迁移中，请先在医院侧完成绑定后刷新目录。",
			showCancel: false,
		});
	},

	/** 从已认证会话重新同步医院目录，不在小程序端拼接身份证或 provider 参数。 */
	onSyncPatients(): Promise<void> {
		if (patientSyncInFlight) return patientSyncInFlight;

		const dataToken = directoryDataGuard.begin();
		const syncToken = syncGuard.begin();
		this.setData({ syncing: true, error: "" });
		const syncRequest = syncPatientsFromHospital(
			`patient-selection-sync-${Date.now()}`,
		)
			.then((patients) => {
				if (
					!directoryDataGuard.isCurrent(dataToken) ||
					!syncGuard.isCurrent(syncToken)
				) {
					return;
				}
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
			.catch((error) => {
				if (syncGuard.isCurrent(syncToken)) {
					this.showError(error, "就诊人同步失败");
				}
			})
			.finally(() => {
				if (syncGuard.isCurrent(syncToken)) {
					this.setData({ syncing: false });
				}
			});
		patientSyncInFlight = syncRequest;
		return syncRequest;
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
				message = safeApiErrorMessage(error, fallback);
			}
		}
		this.setData({ error: message });
	},
});
