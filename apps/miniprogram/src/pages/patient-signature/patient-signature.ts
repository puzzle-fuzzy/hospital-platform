import { loadPatients } from "../../services/dashboard-service";
import { navigateToFeatureStatus } from "../../services/feature-navigation";
import {
	disposePageInstance,
	getPageLatestRequestGuard,
} from "../../services/page-instance-state";
import {
	getSelectedPatientId,
	patientScopedErrorMessage,
} from "../../services/patient-selection-service";
import {
	disposePageSessionResetListener,
	registerPageSessionResetListener,
} from "../../services/session-events";
import type { Patient, PatientEvent } from "../../types";

type SignaturePatientView = Patient & {
	relationshipLabel: string;
};

type PatientSignaturePageData = {
	patients: Array<SignaturePatientView>;
	selectedPatientId: string;
	loading: boolean;
	error: string;
	hasShown: boolean;
};

type PatientSignaturePageMethods = {
	loadPatientList(): Promise<void>;
	onPatientTap(event: PatientEvent): void;
	onOpenPatientSelector(): void;
	onOpenPatientAgreement(): void;
	onOpenMigrationStatus(): void;
	onRetry(): void;
	onBackMy(): void;
	onUnload(): void;
};

/** provider 关系只允许在展示层翻译，不能把中文关系写回平台接口。 */
const PATIENT_RELATIONSHIP_LABELS: Record<Patient["relationship"], string> = {
	self: "本人",
	spouse: "配偶",
	child: "子女",
	parent: "父母",
	other: "其他",
	unknown: "关系未提供",
};

function toPatientView(patient: Patient): SignaturePatientView {
	return {
		...patient,
		relationshipLabel: PATIENT_RELATIONSHIP_LABELS[patient.relationship],
	};
}

/**
 * 旧端签名页展示了患者列表，但列表中的手机号/性别来自旧端本地模型，
 * 还会把患者 ID 和姓名直接交给未知外部小程序。新端只读取平台已经批准
 * 的脱敏患者读模型；签名 contract 完成前，点击患者只更新页面选中态并
 * 明确提示关闭原因，绝不伪造跳转成功，也不改变全局当前就诊人。
 */
Page<PatientSignaturePageData, PatientSignaturePageMethods>({
	data: {
		patients: [],
		selectedPatientId: "",
		loading: true,
		error: "",
		hasShown: false,
	},

	onLoad() {
		this.setData({ hasShown: false });
		registerPageSessionResetListener(
			this,
			() => {
				// 签名页当前仍是关闭态，但患者列表仍属于当前账号；会话变化
				// 后必须撤销姓名、关系和选中状态，不能把旧患者带入后续签名流程。
				this.setData({
					patients: [],
					selectedPatientId: "",
					loading: true,
					error: "",
				});
			},
			() => this.loadPatientList(),
		);
		void this.loadPatientList();
	},

	onShow() {
		if (!this.data.hasShown) {
			this.setData({ hasShown: true });
			return;
		}
		// 从统一选择页返回后必须重新读取 owner-scoped 目录，不能继续显示旧快照。
		void this.loadPatientList();
	},

	loadPatientList() {
		const guard = getPageLatestRequestGuard(this, "patient-signature");
		const token = guard.begin();
		this.setData({ loading: true, error: "", patients: [] });
		return loadPatients()
			.then((patients) => {
				if (!guard.isCurrent(token)) return;
				const selectedPatientId = getSelectedPatientId();
				this.setData({
					patients: patients.map(toPatientView),
					// 只恢复已经由统一选择页明确写入的当前患者，不在签名页
					// 因为列表顺序而静默选择第一位患者。
					selectedPatientId: patients.some(
						(patient) => patient.id === selectedPatientId,
					)
						? selectedPatientId
						: "",
				});
			})
			.catch((error) => {
				if (!guard.isCurrent(token)) return;
				this.setData({
					patients: [],
					selectedPatientId: "",
					error: patientScopedErrorMessage(error),
				});
			})
			.finally(() => {
				if (guard.isCurrent(token)) this.setData({ loading: false });
			});
	},

	onPatientTap(event) {
		const patientId = event.currentTarget?.dataset?.patientId;
		const patient = this.data.patients.find((item) => item.id === patientId);
		if (!patient) return;
		if (patient.clinicalAccess !== "ready") {
			wx.showToast({ title: "该就诊人暂不可用于签名", icon: "none" });
			return;
		}
		this.setData({ selectedPatientId: patient.id });
		wx.showToast({ title: "签名功能尚未开放", icon: "none" });
	},

	onOpenPatientSelector() {
		wx.navigateTo({ url: "/pages/patient-select/patient-select" });
	},

	onOpenPatientAgreement() {
		// 只查看已迁移的协议原文，不记录同意、不上传签名，也不改变患者关系。
		wx.navigateTo({ url: "/pages/patient-agreement/patient-agreement" });
	},

	onOpenMigrationStatus() {
		navigateToFeatureStatus("patient-signature");
	},

	onRetry() {
		if (!this.data.loading) void this.loadPatientList();
	},

	onBackMy() {
		wx.switchTab({ url: "/pages/my/my" });
	},

	onUnload() {
		disposePageSessionResetListener(this);
		disposePageInstance(this);
	},
});
