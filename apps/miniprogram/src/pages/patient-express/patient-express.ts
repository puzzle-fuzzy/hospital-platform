import { loadCurrentPatient } from "../../services/dashboard-service";
import { navigateToFeatureStatus } from "../../services/feature-navigation";
import {
	disposePageInstance,
	getPageLatestRequestGuard,
} from "../../services/page-instance-state";
import {
	type PatientExpressRecordState,
	resolvePatientExpressRecordState,
} from "../../services/patient-express-state";
import {
	patientScopedErrorMessage,
	preservedPatientForReload,
	shouldClearPatientContextAfterError,
} from "../../services/patient-selection-service";
import {
	disposePageSessionResetListener,
	registerPageSessionResetListener,
} from "../../services/session-events";
import { hasPlatformSession } from "../../services/session-service";
import type { Patient } from "../../types";

type PatientExpressPageData = {
	loading: boolean;
	patient: Patient | null;
	error: string;
	recordState: PatientExpressRecordState;
	hasShown: boolean;
};

type PatientExpressPageMethods = {
	loadCurrentPatient(): Promise<void>;
	onOpenPatientSelector(): void;
	onOpenMigrationStatus(): void;
	onRetry(): void;
	onBackMy(): void;
	onUnload(): void;
};

/**
 * 旧端“我的快递”没有真实物流请求：预留列表永远初始化为空数组，
 * 页面实际可迁移的行为只有“展示当前就诊人 + 空态”。
 *
 * 这里先把这段真实旧行为迁移到原生页面，同时保留“物流来源/归属/字段
 * 脱敏”作为未来 contract 门禁。不能为了让页面看起来完整而读取旧缓存、
 * 拼接快递单号或把空数组包装成 provider 查询成功。
 */
Page<PatientExpressPageData, PatientExpressPageMethods>({
	data: {
		loading: true,
		patient: null,
		error: "",
		recordState: "loading",
		hasShown: false,
	},

	onLoad() {
		this.setData({ hasShown: false });
		registerPageSessionResetListener(
			this,
			() => {
				// 账号切换后不得把上一账号的快递患者卡片留在页面上。
				this.setData({
					patient: null,
					loading: true,
					error: "",
					recordState: "loading",
				});
			},
			() => this.loadCurrentPatient(),
		);
		void this.loadCurrentPatient();
	},

	onShow() {
		if (!this.data.hasShown) {
			this.setData({ hasShown: true });
			return;
		}
		// 从选择页返回后必须重新读取当前显式患者，不能继续显示旧姓名。
		void this.loadCurrentPatient();
	},

	loadCurrentPatient() {
		const guard = getPageLatestRequestGuard(this, "patient-express");
		const token = guard.begin();
		// 物流列表没有真实请求，但患者卡片仍然是当前账号已经确认的
		// 上下文。重读期间保留它，不能让“物流能力关闭”造成姓名闪退。
		// 如果用户刚换人或会话刚重置，helper 会拒绝保留旧卡片。
		const preservedPatient = preservedPatientForReload(this.data.patient);
		this.setData({
			loading: true,
			error: "",
			patient: preservedPatient,
			recordState: resolvePatientExpressRecordState(true, ""),
		});
		return loadCurrentPatient()
			.then((patient) => {
				if (!guard.isCurrent(token)) return;
				this.setData({
					patient,
					recordState: resolvePatientExpressRecordState(false, ""),
				});
			})
			.catch((error) => {
				if (!guard.isCurrent(token)) return;
				const message = patientScopedErrorMessage(error);
				const clearPatient = shouldClearPatientContextAfterError(
					error,
					hasPlatformSession(),
				);
				this.setData({
					// 读取失败时仍区分“患者上下文失效”和“下游暂时失败”。
					// 后者保留姓名卡片，避免用户把物流关闭态误解成没有患者。
					patient: clearPatient
						? null
						: preservedPatientForReload(this.data.patient),
					error: message,
					recordState: resolvePatientExpressRecordState(false, message),
				});
			})
			.finally(() => {
				if (guard.isCurrent(token)) this.setData({ loading: false });
			});
	},

	onOpenPatientSelector() {
		wx.navigateTo({ url: "/pages/patient-select/patient-select" });
	},

	/** 物流真实 contract 到达前，只允许进入说明页，不发起任何外部请求。 */
	onOpenMigrationStatus() {
		navigateToFeatureStatus("patient-express");
	},

	onRetry() {
		if (!this.data.loading) void this.loadCurrentPatient();
	},

	onBackMy() {
		wx.switchTab({ url: "/pages/my/my" });
	},

	onUnload() {
		disposePageSessionResetListener(this);
		disposePageInstance(this);
	},
});
