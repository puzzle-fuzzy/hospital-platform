import { ApiError } from "../../services/api-client";
import { loadCurrentPatient } from "../../services/dashboard-service";
import { navigateToFeatureStatus } from "../../services/feature-navigation";
import {
	disposePageInstance,
	getPageLatestRequestGuard,
} from "../../services/page-instance-state";
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

function errorMessage(error: unknown): string {
	if (error instanceof ApiError && error.code === "unauthorized") {
		return "登录状态已失效，请返回首页重新登录";
	}
	if (error instanceof ApiError && error.code === "patient-not-bound") {
		return "请先登录并选择就诊人";
	}
	if (error instanceof ApiError && error.code === "dependency-not-configured") {
		return "就诊人服务暂不可用，请稍后重试";
	}
	return "当前就诊人信息暂时无法加载，请重试";
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
		this.setData({ loading: true, error: "", patient: null });
		return loadCurrentPatient()
			.then((patient) => {
				if (guard.isCurrent(token))
					this.setData({ patient: toPatientView(patient) });
			})
			.catch((error) => {
				if (guard.isCurrent(token)) {
					this.setData({ patient: null, error: errorMessage(error) });
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
		disposePageInstance(this);
	},
});
