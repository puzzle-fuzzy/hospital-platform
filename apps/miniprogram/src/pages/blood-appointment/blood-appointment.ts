import { loadCurrentPatient } from "../../services/dashboard-service";
import { navigateToFeatureStatus } from "../../services/feature-navigation";
import {
	disposePageInstance,
	getPageLatestRequestGuard,
} from "../../services/page-instance-state";
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

type BloodAppointmentPatientView = Patient & {
	relationshipLabel: string;
};

type BloodAppointmentPageData = {
	patient: BloodAppointmentPatientView | null;
	loading: boolean;
	error: string;
	hasShown: boolean;
};

type BloodAppointmentPageMethods = {
	loadPatient(): Promise<void>;
	onOpenPatientSelector(): void;
	onOpenMigrationStatus(): void;
	onRetry(): void;
	onBackHome(): void;
	onUnload(): void;
};

/** provider 关系只在小程序展示层翻译，不能把中文标签作为请求参数发送。 */
const PATIENT_RELATIONSHIP_LABELS: Record<Patient["relationship"], string> = {
	self: "本人",
	spouse: "配偶",
	child: "子女",
	parent: "父母",
	other: "其他",
	unknown: "关系未提供",
};

function toPatientView(patient: Patient): BloodAppointmentPatientView {
	return {
		...patient,
		relationshipLabel: PATIENT_RELATIONSHIP_LABELS[patient.relationship],
	};
}

/** 保留患者卡片时也必须带上页面需要的关系标签，不能把裸目录类型直接写入 WXML。 */
function toOptionalPatientView(
	patient: Patient | null,
): BloodAppointmentPatientView | null {
	return patient ? toPatientView(patient) : null;
}

/**
 * 旧端采血预约页的真实行为是：展示硬编码患者和院区，项目列表固定为空，
 * 没有采血号源请求，也没有预约写入。新端只迁移可验证的患者上下文、院区
 * 视觉位置和“无可预约项目”空态；不把旧端硬编码患者/院区当作当前账号事实，
 * 不复用普通门诊号源，也不创建预约或显示成功。
 */
Page<BloodAppointmentPageData, BloodAppointmentPageMethods>({
	data: {
		patient: null,
		loading: true,
		error: "",
		hasShown: false,
	},

	onLoad() {
		this.setData({ hasShown: false });
		registerPageSessionResetListener(
			this,
			() => {
				// 采血页面没有写操作，会话变化时清理展示快照即可。
				this.setData({
					patient: null,
					loading: true,
					error: "",
				});
			},
			() => this.loadPatient(),
		);
		void this.loadPatient();
	},

	onShow() {
		if (!this.data.hasShown) {
			this.setData({ hasShown: true });
			return;
		}
		// 从统一选择页返回后重新确认当前患者，不能继续展示旧快照。
		void this.loadPatient();
	},

	loadPatient() {
		const guard = getPageLatestRequestGuard(this, "blood-appointment");
		const token = guard.begin();
		// 患者目录重读期间只更新加载状态；同一会话、同一明确选择的患者
		// 仍是已经确认过的视觉上下文，不能因为采血业务尚未开放而闪退。
		// 用户换人或会话重置时，preservedPatientForReload 会返回 null，
		// 因此不会把上一位患者带入新上下文。
		const preservedPatient = preservedPatientForReload(this.data.patient);
		this.setData({
			loading: true,
			error: "",
			patient: toOptionalPatientView(preservedPatient),
		});
		return loadCurrentPatient()
			.then((patient) => {
				if (guard.isCurrent(token))
					this.setData({ patient: toPatientView(patient) });
			})
			.catch((error) => {
				if (guard.isCurrent(token)) {
					const clearPatient = shouldClearPatientContextAfterError(
						error,
						hasPlatformSession(),
					);
					this.setData({
						// Provider、持久化或网络故障不代表患者消失；只有会话
						// 失效才清掉已确认卡片，避免用户看到错误的“未选择”。
						patient: clearPatient
							? null
							: toOptionalPatientView(
									preservedPatientForReload(this.data.patient),
								),
						error: patientScopedErrorMessage(error),
					});
				}
			})
			.finally(() => {
				if (guard.isCurrent(token)) this.setData({ loading: false });
			});
	},

	onOpenPatientSelector() {
		wx.navigateTo({ url: "/pages/patient-select/patient-select" });
	},

	onOpenMigrationStatus() {
		navigateToFeatureStatus("blood-appointment");
	},

	onRetry() {
		if (!this.data.loading) void this.loadPatient();
	},

	onBackHome() {
		wx.switchTab({ url: "/pages/index/index" });
	},

	onUnload() {
		disposePageSessionResetListener(this);
		disposePageInstance(this);
	},
});
