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
import { navigateToFeatureStatus } from "../../services/feature-navigation";
import { switchToPrimaryTab } from "../../services/patient-navigation";
import {
	getSelectedPatientId,
	isBoundedPatientId,
	patientContextErrorMessage,
	patientSelectionResolutionMessage,
	resolvePatientSelection,
	resolveStoredPatientSelection,
	setSelectedPatientId,
} from "../../services/patient-selection-service";
import {
	getSessionGeneration,
	isCurrentSessionGeneration,
} from "../../services/session-generation";
import { hasPlatformSession } from "../../services/session-service";
import type {
	Patient,
	PatientEvent,
	PatientSelectionPageData,
	PatientSelectionView,
} from "../../types";

type PatientSelectionPageMethods = {
	loadPatientList(): Promise<void>;
	onRetry(): void;
	onShow(): void;
	onPatientTap(event: PatientEvent): void;
	onAddPatient(): void;
	onSyncPatients(): Promise<void>;
	syncPatientDirectoryForLoad(loadToken: number): Promise<void>;
	onPullDownRefresh(): void;
	onUnload(): void;
	clearDisplayedPatientDirectory(): void;
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

/**
 * 选择页当前列表所属的会话代际。
 *
 * 选择页可能在页面栈中停留较久；期间其它页面完成重新登录或 token
 * 轮换时，旧页面仍然保留着姓名、关系和脱敏卡号。页面级请求 guard 只能
 * 淘汰同一页面的新旧请求，不能识别“请求已经结束后账号才发生变化”的
 * 情况，因此这里额外记录本页最后一次成功同步所对应的会话代际。
 * 使用 WeakMap 保存非渲染状态，避免把内部会话序号写入 WXML 或 storage。
 */
const patientSelectionSessionGenerations = new WeakMap<object, number>();

function markPatientSelectionSession(page: object): number {
	const generation = getSessionGeneration();
	patientSelectionSessionGenerations.set(page, generation);
	return generation;
}

function isPatientSelectionSessionCurrent(page: object): boolean {
	const generation = patientSelectionSessionGenerations.get(page);
	return generation !== undefined && isCurrentSessionGeneration(generation);
}

/**
 * provider 关系值是稳定枚举，中文文案由小程序展示层维护。
 * “其他”只对应 provider 的明确分类；关系未提供单独展示，避免产生误解。
 */
const PATIENT_RELATIONSHIP_LABELS: Record<Patient["relationship"], string> = {
	self: "本人",
	spouse: "配偶",
	child: "子女",
	parent: "父母",
	other: "其他",
	unknown: "关系未提供",
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

/**
 * 判断患者目录是否已经失去当前会话的 owner 证明。
 *
 * Provider/Redis/MySQL 暂时故障时，旧目录仍可作为诊断和重试线索；但
 * unauthorized、session-changed 或自动重新登录失败后没有 token，旧目录
 * 不能继续展示，否则新账号可能看到上一账号的患者姓名、关系和脱敏卡号。
 */
function shouldClearPatientDirectory(error: unknown): boolean {
	if (!hasPlatformSession()) return true;
	return (
		error instanceof ApiError &&
		(error.code === "unauthorized" || error.code === "session-changed")
	);
}

Page<PatientSelectionPageData, PatientSelectionPageMethods>({
	data: {
		hasShown: false,
		patients: [],
		selectedPatientId: "",
		loading: true,
		syncing: false,
		selectionReady: false,
		navigationPending: false,
		error: "",
	},

	onLoad() {
		// 首次 onShow 会紧跟 onLoad 触发；使用页面实例标记避免同一轮目录
		// 读取被生命周期重复启动。页面重新从栈中显示时，onShow 再负责
		// 重新确认 owner 和会话代际，不能继续信任旧页面快照。
		this.setData({ hasShown: false });
		// 不能在 owner-scoped 目录返回前直接把本地缓存画成“当前”患者；
		// 当前标记只能由本次成功读取并完成临床映射确认的目录恢复。
		this.loadPatientList();
	},

	/**
	 * 页面栈返回时重新读取当前 owner 的患者目录。
	 *
	 * 选择页可能在页面栈中停留期间发生 token 轮换、账号切换或其它页面
	 * 收到 401。仅在点击患者时检查会话代际太晚：用户在此之前已经能看到
	 * 上一轮姓名、关系和脱敏卡号。因此每次从其它页面返回都先清空当前
	 * 派生目录，再以最新平台会话执行“目录读取 + 临床映射同步”完整流程。
	 */
	onShow(): void {
		if (!this.data.hasShown) {
			this.setData({ hasShown: true });
			return;
		}

		if (!hasPlatformSession()) {
			// 没有待验证 token 时，旧目录不能继续作为当前账号的医疗事实；
			// 选择页没有独立登录入口，回首页由用户明确确认微信账号。
			this.clearDisplayedPatientDirectory();
			wx.showToast({ title: "登录状态已失效，请重新登录", icon: "none" });
			// 首页是原生主 Tab，回首页必须复用微信 TabBar 生命周期，不能
			// 用 reLaunch 重建页面树导致底栏闪烁或 selected 状态丢失。
			switchToPrimaryTab("/pages/index/index");
			return;
		}

		// loadPatientList 会把 loading 置为 true，使旧列表在请求期间不再
		// 进入 WXML；这里提前清空，避免 setData 尚未完成时出现旧卡片闪现。
		this.clearDisplayedPatientDirectory();
		void this.loadPatientList();
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
	 * 错误态重试必须重新执行“平台目录读取 + 临床映射同步”完整链路。
	 * 不能只清除 error 或复用上一轮 patients，否则页面会把旧目录误当成
	 * 当前会话的可选患者；真正的选择资格只能由本轮同步成功恢复。
	 */
	onRetry(): void {
		void this.loadPatientList();
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
		if (!isPatientSelectionSessionCurrent(this)) {
			// 会话在列表同步完成后发生了变化，当前卡片不能再作为新账号的
			// 患者上下文。先清掉页面上的医疗派生数据，再重新读取当前会话；
			// 不能把旧 patientId 写入 storage 后交给首页自行猜测归属。
			this.clearDisplayedPatientDirectory();
			wx.showToast({ title: "登录状态已变化，正在重新刷新", icon: "none" });
			void this.loadPatientList();
			return;
		}
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
		if (!isBoundedPatientId(patientId)) {
			wx.showToast({ title: "就诊人数据异常，请刷新", icon: "none" });
			return;
		}
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

	/** 绑定写入接口尚未通过真实医院契约验收，统一进入状态页而不是伪造成功。 */
	onAddPatient(): void {
		navigateToFeatureStatus("patient-binding");
	},

	/**
	 * 从已认证会话重新同步医院目录；真机按钮的事件入口。
	 *
	 * 不在小程序端拼接身份证或 provider 参数。`loadToken` 表示一次“目录读取 +
	 * 临床同步”的完整刷新周期；选择页的旧同步即使比新读取更晚返回，也必须
	 * 失去回写资格。页面级 single-flight 复用在途 Promise 时，后发调用方仍要消费同一个患者数组，
	 * 不能只复用一个已经绑定在旧调用方闭包里的 void Promise，
	 * 否则新一轮刷新会永远停在不可选择。
	 *
	 * WXML `bindtap` 会传入微信事件对象，不能把这个参数直接转交给内部的 number
	 * 类型加载 token。此前按钮直接绑定带 token 参数的方法，运行时会把事件对象
	 * 误当成 token，`isCurrent` 永远返回 false，表现为点击“刷新就诊人”没有真正
	 * 发起同步。这里单独创建本轮加载 token，再交给只接受 number 的内部流程，明确
	 * 隔离框架事件和业务状态。
	 */
	onSyncPatients(): Promise<void> {
		// 选择完成后页面已经进入延迟返回窗口；此时再次启动同步会让即将
		// 离开的页面发起第二条 Provider 命令，并把“选择患者”和“刷新目录”
		// 两个不同业务动作混在同一个页面周期内。WXML 已经禁用按钮，方法层
		// 仍保留门禁，防止测试、无障碍或未来其它入口绕过视图属性。
		if (this.data.navigationPending) return Promise.resolve();
		const listLoadGuard = getPageLatestRequestGuard(this, "patient-list-load");
		return this.syncPatientDirectoryForLoad(listLoadGuard.begin());
	},

	/** 执行一次患者目录同步；调用方必须传入当前页面的加载周期 token。 */
	syncPatientDirectoryForLoad(loadToken: number): Promise<void> {
		const listLoadGuard = getPageLatestRequestGuard(this, "patient-list-load");
		if (!listLoadGuard.isCurrent(loadToken)) return Promise.resolve();

		const patientSyncFlight = getPageSingleFlight<Array<Patient>>(
			this,
			`patient-sync:${getSessionGeneration()}`,
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
				/**
				 * `syncPatientsFromHospital` 内部会先验证 `/me`，GET 在 401 时
				 * 可以安全换取新平台会话并推进代际。因此不能在 Promise 发起前
				 * 固定旧代际，否则“旧 token → 自动恢复 → 新 token”的正常成功
				 * 路径会被误判为旧结果。requestWithSession 已在同一请求的响应
				 * 边界校验代际和 token；此处只在当前页面令牌仍有效时记录成功
				 * 快照所属代际，供后续点击患者时做 owner 校验。
				 */
				markPatientSelectionSession(this);
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
		// 下拉刷新同样是目录同步命令；选择完成后等待返回期间必须停止刷新，
		// 避免旧页面在返回调用页前又创建一轮患者快照。
		if (this.data.navigationPending) {
			wx.stopPullDownRefresh();
			return;
		}
		this.loadPatientList().finally(() => wx.stopPullDownRefresh());
	},

	onUnload(): void {
		// 页面卸载后不能再调用 setData；直接清理当前实例的定时器，
		// 让延迟回调根本没有机会在新页面栈上继续 navigateBack。
		const navigationTimer = patientNavigationTimers.get(this);
		if (navigationTimer !== undefined) clearTimeout(navigationTimer);
		patientNavigationTimers.delete(this);
		patientSelectionSessionGenerations.delete(this);
		disposePageInstance(this);
	},

	showError(error: unknown, fallback: string): void {
		const message =
			error instanceof ApiError && error.code === "dependency-not-configured"
				? "就诊人服务暂未配置完成，请联系管理员"
				: patientContextErrorMessage(error, fallback);
		const sessionDisplayInvalid = shouldClearPatientDirectory(error);
		// 同步失败时可以保留列表帮助诊断和重试，但不能保留上一轮“当前”标记；
		// 否则用户会误以为该患者的 his-patient 映射仍已确认。这里不删除本地
		// opaque patientId，目录恢复后仍可正确进入 stale 判断，避免静默换人。
		// 但会话归属已经失效时连患者列表也必须清理：列表中的姓名、关系和
		// 脱敏卡号同样属于当前 owner 的派生数据，不能把“保留诊断列表”扩大
		// 成“跨账号继续展示医疗目录”。
		if (sessionDisplayInvalid) {
			this.clearDisplayedPatientDirectory();
			// 选择页没有自己的登录入口。命令请求（例如患者同步）失效后，
			// 不能在当前页面自动重登并重放；清理 owner-scoped 目录后回首页，
			// 由用户明确确认当前微信账号，再重新发起同步动作。
			wx.showToast({ title: "登录状态已失效，请重新登录", icon: "none" });
			// 即使是错误恢复也必须沿用共享 TabBar，避免 reLaunch 造成底栏
			// 短暂消失后重新创建。
			switchToPrimaryTab("/pages/index/index");
			return;
		}
		this.setData({
			error: message,
			selectedPatientId: "",
			selectionReady: false,
		});
	},

	/**
	 * 清理当前页面中失去 owner 证明的患者目录展示。
	 *
	 * 只清理页面派生状态，不删除本地 opaque 选择、不修改服务端目录，也不
	 * 触碰会话存储；重新建立有效会话后，下一次目录读取仍会按 stale 规则恢复。
	 */
	clearDisplayedPatientDirectory(): void {
		this.setData({
			patients: [],
			selectedPatientId: "",
			selectionReady: false,
		});
	},
});
