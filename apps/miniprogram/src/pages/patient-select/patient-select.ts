import { ApiError } from "../../services/api-client";
import {
	loadPatients,
	syncPatientsFromHospital,
} from "../../services/dashboard-service";
import {
	disposePageInstance,
	getPageLatestRequestGuard,
	getPageSingleFlight,
} from "../../services/page-instance-state";
import {
	getSelectedPatientId,
	patientContextErrorMessage,
	patientSelectionResolutionMessage,
	resolvePatientSelection,
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
	syncPatientDirectoryForLoad(loadToken: number): Promise<void>;
	onPullDownRefresh(): void;
	onUnload(): void;
	showError(error: unknown, fallback: string): void;
	setPatientList(patients: Array<Patient>, restoreSelection?: boolean): void;
};

/**
 * 切换患者成功后的延迟回跳定时器必须按页面实例隔离。
 *
 * 选择页可能被多次打开并同时存在于页面栈中，不能用模块级单个 timer
 * 保存状态。WeakMap 让每个页面只清理自己的回跳任务，也避免页面卸载后
 * 因强引用长期保留页面对象。
 */
const patientNavigationTimers = new WeakMap<
	object,
	ReturnType<typeof setTimeout>
>();

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

/** 目录可展示不等于可用于临床查询；只有存在 ready 患者才允许返回调用页。 */
function hasClinicallyReadyPatients(patients: readonly Patient[]): boolean {
	return patients.some((patient) => patient.clinicalAccess === "ready");
}

Page<PatientSelectionPageData, PatientSelectionPageMethods>({
	data: {
		patients: [],
		selectedPatientId: "",
		loading: true,
		syncing: false,
		selectionReady: false,
		navigationPending: false,
		error: "",
	},

	onLoad() {
		// 不能在 owner-scoped 目录返回前直接把本地缓存画成“当前”患者；
		// 当前标记只能由本次成功读取并完成临床映射确认的目录恢复。
		this.loadPatientList();
	},

	/** 进入页面先读取平台目录，再主动同步一次临床映射，保证直接打开选择页也可用。 */
	loadPatientList(): Promise<void> {
		const listLoadGuard = getPageLatestRequestGuard(this, "patient-list-load");
		const loadingGuard = getPageLatestRequestGuard(this, "loading");
		const loadToken = listLoadGuard.begin();
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
				if (!listLoadGuard.isCurrent(loadToken)) return;
				// 目录读取只证明平台目录可读，不证明本轮 HIS 临床映射已经收敛；
				// 预同步阶段只能展示患者资料，禁止先恢复本地“当前”标记。
				this.setPatientList(patients, false);
				// 选择页也可能被历史路径直接打开，不能依赖首页先完成临床映射；
				// 无论本地是否已有目录记录，都主动同步一次，确保首次登录也能得到临床映射。
				// 选择页的目录读取完成后还必须等待一次完整同步；否则下拉刷新会
				// 提前结束，调用页可能在 HIS 映射尚未落库时开始预约/报告查询。
				// loading 由外层 finally 统一关闭，不能在这里提前置 false。
				return this.syncPatientDirectoryForLoad(loadToken);
			})
			.catch((error) => {
				if (
					listLoadGuard.isCurrent(loadToken) &&
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
	setPatientList(patients: Array<Patient>, restoreSelection = true): void {
		// 空目录不等于用户主动清除了选择：可能是 provider 暂时没有返回数据，
		// 也可能是当前账号暂时没有绑定患者。保留本地 opaque patientId，避免
		// 目录恢复后被误判为“从未选择”并静默切换到第一位患者；真正的清理只
		// 在会话失效或用户明确退出/清除上下文时发生。
		// 预同步阶段只能用纯函数读取已有选择，绝不能调用
		// resolveStoredPatientSelection：后者在首次没有选择时会把第一位 ready
		// 患者写入 storage。那会让同步失败后的下一次业务页误以为该患者已经
		// 通过本轮临床映射确认，形成“没有当前标记但本地已有隐式选择”的绕过。
		const resolution = restoreSelection
			? resolveStoredPatientSelection(patients)
			: resolvePatientSelection(patients, getSelectedPatientId());
		const selectedPatientId = restoreSelection
			? (resolution.patient?.id ?? "")
			: "";
		this.setData({
			patients: patients.map(toPatientSelectionView),
			selectedPatientId,
			error:
				!restoreSelection || resolution.state === "empty"
					? ""
					: patientSelectionResolutionMessage(resolution),
		});
	},

	/** 选择完成后只写入 opaque patientId，再返回调用页触发 onShow 刷新。 */
	onPatientTap(event: PatientEvent): void {
		// 目录读取成功不等于医院侧临床映射已经完成。同步期间即使页面还显示上一轮
		// 列表，也必须禁止返回调用页，否则调用页可能在 his-patient 尚未落库时发起
		// 预约、报告或门诊费用查询；失败后保留列表只用于诊断，不能被当作可用上下文。
		if (
			this.data.loading ||
			this.data.syncing ||
			!this.data.selectionReady ||
			this.data.navigationPending
		) {
			wx.showToast({ title: "就诊人正在同步，请稍后", icon: "none" });
			return;
		}
		const patientId = event.currentTarget?.dataset?.patientId;
		if (typeof patientId !== "string" || !patientId) return;
		const patient = this.data.patients.find((item) => item.id === patientId);
		if (!patient) return;
		if (patient.clinicalAccess !== "ready") {
			// 旧目录记录仍可展示给用户核对，但不能写入本地选择；否则业务页
			// 会在 provider 请求前失败，用户也无法判断是哪个患者上下文有问题。
			wx.showToast({
				title: "该就诊人暂不可用于查询，请先刷新",
				icon: "none",
			});
			return;
		}

		setSelectedPatientId(patient.id);
		this.setData({ navigationPending: true });
		wx.showToast({ title: "已切换就诊人", icon: "success" });
		const navigationTimer = setTimeout(() => {
			patientNavigationTimers.delete(this);
			// 用户可能在 toast 期间手动返回；onUnload 会先清理定时器，
			// 防止旧选择页在页面栈变化后又 navigateBack。
			if (!this.data.navigationPending) return;
			this.setData({ navigationPending: false });
			wx.navigateBack();
		}, 350);
		patientNavigationTimers.set(this, navigationTimer);
	},

	/** 绑定写入接口尚未通过真实医院契约验收，先明确提示而不是伪造成功。 */
	onAddPatient(): void {
		wx.showModal({
			title: "添加就诊人",
			content: "医院绑定接口正在迁移中，请先在医院侧完成绑定后刷新目录。",
			showCancel: false,
		});
	},

	/**
	 * 从已认证会话重新同步医院目录，不在小程序端拼接身份证或 provider 参数。
	 *
	 * `loadToken` 表示一次“目录读取 + 临床同步”的完整刷新周期。选择页的旧同步
	 * 即使比新读取更晚返回，也必须失去回写资格；反过来，页面级 single-flight
	 * 复用在途 Promise 时，后发调用方仍要消费同一个患者数组，不能只复用一个
	 * 已经绑定在旧调用方闭包里的 void Promise，否则新一轮刷新会永远停在不可选择。
	 */
	/**
	 * 真机按钮的事件入口。
	 *
	 * WXML bindtap 会传入微信事件对象，不能把这个参数直接转交给内部的
	 * number 类型加载 token。此前按钮直接绑定带 token 参数的方法，运行时
	 * 会把事件对象误当成 token，`isCurrent` 永远返回 false，表现为点击
	 * “刷新就诊人”没有真正发起同步。这里单独创建本轮加载 token，再交给
	 * 只接受 number 的内部流程，明确隔离框架事件和业务状态。
	 */
	onSyncPatients(): Promise<void> {
		const listLoadGuard = getPageLatestRequestGuard(this, "patient-list-load");
		return this.syncPatientDirectoryForLoad(listLoadGuard.begin());
	},

	/** 执行一次患者目录同步；调用方必须传入当前页面的加载周期 token。 */
	syncPatientDirectoryForLoad(loadToken: number): Promise<void> {
		const listLoadGuard = getPageLatestRequestGuard(this, "patient-list-load");
		if (!listLoadGuard.isCurrent(loadToken)) return Promise.resolve();

		const patientSyncFlight = getPageSingleFlight<Array<Patient>>(
			this,
			"patient-sync",
		);
		const syncGuard = getPageLatestRequestGuard(this, "sync");
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

		// single-flight 只负责共享远端 Promise；目录回写必须在每个调用方自己的
		// loadToken/syncToken 仍有效时执行，避免旧页面周期覆盖新周期。
		return patientSyncFlight
			.run(() => syncPatientsFromHospital("patient-selection-sync"))
			.then((patients) => {
				if (
					!listLoadGuard.isCurrent(loadToken) ||
					!syncGuard.isCurrent(syncToken)
				) {
					return;
				}
				this.setPatientList(patients);
				this.setData({
					selectionReady: hasClinicallyReadyPatients(patients),
				});
				// setPatientList 已按同一份成功快照解析并写入 empty/stale/
				// unavailable 文案；这里仅更新“是否可点击”的门禁，不能按
				// 数组长度或 ready 数量重新推断业务状态，避免覆盖 stale 语义。
			})
			.catch((error) => {
				if (
					listLoadGuard.isCurrent(loadToken) &&
					syncGuard.isCurrent(syncToken)
				) {
					this.showError(error, "就诊人同步失败");
				}
			})
			.finally(() => {
				if (
					listLoadGuard.isCurrent(loadToken) &&
					syncGuard.isCurrent(syncToken)
				) {
					this.setData({ syncing: false });
				}
			});
	},

	onPullDownRefresh(): void {
		this.loadPatientList().finally(() => wx.stopPullDownRefresh());
	},

	onUnload(): void {
		// 页面卸载后不能再调用 setData；直接清理当前实例的定时器，
		// 让延迟回调根本没有机会在新页面栈上继续 navigateBack。
		const navigationTimer = patientNavigationTimers.get(this);
		if (navigationTimer !== undefined) clearTimeout(navigationTimer);
		patientNavigationTimers.delete(this);
		disposePageInstance(this);
	},

	showError(error: unknown, fallback: string): void {
		const message =
			error instanceof ApiError && error.code === "dependency-not-configured"
				? "就诊人服务暂未配置完成，请联系管理员"
				: patientContextErrorMessage(error, fallback);
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
