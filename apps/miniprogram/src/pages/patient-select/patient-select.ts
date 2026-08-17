import { ApiError, safeApiErrorMessage } from "../../services/api-client";
import {
	loadPatients,
	syncPatientsFromHospital,
} from "../../services/dashboard-service";
import {
	getPageLatestRequestGuard,
	getPageSingleFlight,
} from "../../services/page-instance-state";
import {
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
 * 但旧读取不能阻止当前刷新正确结束 loading 状态。三个 guard 和同步
 * 单飞对象都按当前页面实例隔离，避免页面栈中的选择页互相取消状态。
 *
 * 自动同步和用户手动刷新可能同时触发；同一页面只允许一个同步请求进入 provider。
 * 服务端仍以 owner + Idempotency-Key 做最终幂等，这里是防止真机重复事件的第一层保护。
 */
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
		selectionReady: false,
		error: "",
	},

	onLoad() {
		// 不能在 owner-scoped 目录返回前直接把本地缓存画成“当前”患者；
		// 当前标记只能由本次成功读取并完成临床映射确认的目录恢复。
		this.loadPatientList();
	},

	/** 进入页面先读取平台目录，再主动同步一次临床映射，保证直接打开选择页也可用。 */
	loadPatientList(): Promise<void> {
		const directoryDataGuard = getPageLatestRequestGuard(
			this,
			"directory-data",
		);
		const loadingGuard = getPageLatestRequestGuard(this, "loading");
		const dataToken = directoryDataGuard.begin();
		const loadingToken = loadingGuard.begin();
		this.setData({
			loading: true,
			syncing: false,
			selectionReady: false,
			selectedPatientId: "",
			error: "",
		});
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
		// 空目录不等于用户主动清除了选择：可能是 provider 暂时没有返回数据，
		// 也可能是当前账号暂时没有绑定患者。保留本地 opaque patientId，避免
		// 目录恢复后被误判为“从未选择”并静默切换到第一位患者；真正的清理只
		// 在会话失效或用户明确退出/清除上下文时发生。
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
		// 目录读取成功不等于医院侧临床映射已经完成。同步期间即使页面还显示上一轮
		// 列表，也必须禁止返回调用页，否则调用页可能在 his-patient 尚未落库时发起
		// 预约、报告或门诊费用查询；失败后保留列表只用于诊断，不能被当作可用上下文。
		if (this.data.loading || this.data.syncing || !this.data.selectionReady) {
			wx.showToast({ title: "就诊人正在同步，请稍后", icon: "none" });
			return;
		}
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
		const patientSyncFlight = getPageSingleFlight<void>(this, "patient-sync");
		return patientSyncFlight.run(() => {
			const directoryDataGuard = getPageLatestRequestGuard(
				this,
				"directory-data",
			);
			const syncGuard = getPageLatestRequestGuard(this, "sync");
			const dataToken = directoryDataGuard.begin();
			const syncToken = syncGuard.begin();
			// 每次同步开始都先撤销上一次“可选择”状态；只有完整快照成功返回后才能恢复。
			// 临床映射尚未被本轮同步确认前，不展示上一轮“当前”患者；同步成功后
			// setPatientList 会基于最新 owner-scoped 目录恢复正确的展示标记。
			this.setData({
				syncing: true,
				selectionReady: false,
				selectedPatientId: "",
				error: "",
			});
			return syncPatientsFromHospital("patient-selection-sync")
				.then((patients) => {
					if (
						!directoryDataGuard.isCurrent(dataToken) ||
						!syncGuard.isCurrent(syncToken)
					) {
						return;
					}
					this.setPatientList(patients);
					this.setData({ selectionReady: patients.length > 0 });
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
		});
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
		// 同步失败时可以保留列表帮助诊断和重试，但不能保留上一轮“当前”标记；
		// 否则用户会误以为该患者的 his-patient 映射仍已确认。这里不删除本地
		// opaque patientId，目录恢复后仍可正确进入 stale 判断，避免静默换人。
		this.setData({
			error: message,
			selectedPatientId: "",
			selectionReady: false,
		});
	},
});
