import { ApiError } from "../../services/api-client";
import { toAppointmentRecordView } from "../../services/appointment-record-view";
import {
	loadConsultationHistoryRecords,
	loadPatientsForOwner,
} from "../../services/dashboard-service";
import { waitForGlobalUserProfile } from "../../services/global-user-profile";
import {
	disposePageInstance,
	getPageLatestRequestGuard,
} from "../../services/page-instance-state";
import { navigateToPatientSelector } from "../../services/patient-navigation";
import {
	patientSelectionResolutionMessage,
	resolveStoredPatientSelection,
} from "../../services/patient-selection-service";
import { toPatientSurfaceData } from "../../services/patient-surface-context";
import { assertSessionGeneration } from "../../services/session-boundary";
import {
	disposePageSessionResetListener,
	registerPageSessionResetListener,
} from "../../services/session-events";
import { getSessionGeneration } from "../../services/session-generation";
import {
	hasPlatformSession,
	sessionStateAfterAuthenticatedReadError,
} from "../../services/session-service";
import type { ConsultationPageData, Patient } from "../../types";

const CONSULTATION_PAGE_SIZE = 8;

type ConsultationPageMethods = {
	loadContext(): Promise<void>;
	onChangePatient(): void;
	onRetry(): void;
	onLoadMore(): void;
	onUnload(): void;
};

function applyPatientContext(
	page: WechatMiniprogram.Page.Instance<
		ConsultationPageData,
		ConsultationPageMethods
	>,
	patient: Patient | null,
): void {
	const surface = toPatientSurfaceData(patient);
	page.setData({
		selectedPatient: surface.currentPatient ?? null,
		selectedPatientName: surface.currentPatientName ?? "未选择就诊人",
		selectedPatientCardLabel:
			surface.currentPatientCardLabel ?? "就诊卡信息不可用",
	});
}

Page<ConsultationPageData, ConsultationPageMethods>({
	data: {
		hasShown: false,
		sessionState: "checking",
		queryState: "loading",
		selectedPatient: null,
		selectedPatientName: "正在获取就诊人...",
		selectedPatientCardLabel: "就诊卡信息加载中",
		patientSessionGeneration: -1,
		records: [],
		visibleRecords: [],
		visibleRecordCount: 0,
		hasMoreRecords: false,
		loading: true,
		error: "",
		canSelectPatient: false,
	},

	onLoad() {
		this.setData({ hasShown: false });
		registerPageSessionResetListener(this, () => {
			this.setData({
				sessionState: "checking",
				queryState: "loading",
				selectedPatient: null,
				selectedPatientName: "正在获取就诊人...",
				selectedPatientCardLabel: "就诊卡信息加载中",
				patientSessionGeneration: -1,
				records: [],
				visibleRecords: [],
				visibleRecordCount: 0,
				hasMoreRecords: false,
				loading: false,
				error: "登录账号已切换，请重新读取问诊记录",
				canSelectPatient: false,
			});
		});
		void this.loadContext();
	},

	onShow() {
		if (!this.data.hasShown) {
			this.setData({ hasShown: true });
			return;
		}
		void this.loadContext();
	},

	/**
	 * 复刻旧端“我的问诊”的列表摘要。当前使用 owner-scoped 的兼容历史
	 * 读模型，保留患者选择、科室、时间、序号和地点；不恢复旧端硬编码
	 * 患者号、演示记录、问诊正文、附件或实时会话。
	 */
	loadContext(): Promise<void> {
		const guard = getPageLatestRequestGuard(this, "consultation-context");
		const token = guard.begin();
		this.setData({
			loading: true,
			error: "",
			sessionState: "checking",
			queryState: "loading",
			selectedPatient: null,
			selectedPatientName: "正在获取就诊人...",
			selectedPatientCardLabel: "就诊卡信息加载中",
			patientSessionGeneration: -1,
			records: [],
			visibleRecords: [],
			visibleRecordCount: 0,
			hasMoreRecords: false,
		});

		return waitForGlobalUserProfile()
			.then((profileState) => {
				if (!guard.isCurrent(token)) return undefined;
				if (!profileState.ownerId || !hasPlatformSession()) {
					this.setData({
						sessionState: "invalid",
						queryState: "error",
						error: "请先完成微信登录验证",
						canSelectPatient: false,
					});
					return undefined;
				}
				this.setData({ sessionState: "valid" });
				return loadPatientsForOwner(profileState.ownerId);
			})
			.then((result) => {
				if (!result || !guard.isCurrent(token)) return;
				const resolution = resolveStoredPatientSelection(result.patients);
				const patient = resolution.patient ?? null;
				applyPatientContext(this, patient);
				if (!patient) {
					this.setData({
						queryState: "empty",
						error: patientSelectionResolutionMessage(resolution),
						canSelectPatient: true,
					});
					return;
				}

				const sessionGeneration = result.sessionGeneration;
				assertSessionGeneration(
					sessionGeneration,
					"Consultation page session changed before history was requested",
				);
				return loadConsultationHistoryRecords(
					patient.id,
					new Date(),
					sessionGeneration,
				).then((records) => {
					assertSessionGeneration(
						sessionGeneration,
						"Consultation page session changed before history was committed",
					);
					if (
						!guard.isCurrent(token) ||
						!hasPlatformSession() ||
						getSessionGeneration() !== sessionGeneration
					)
						return;
					const recordViews = records.map((record, index) =>
						toAppointmentRecordView(record, index, "consult-record", token),
					);
					const visibleCount = Math.min(
						CONSULTATION_PAGE_SIZE,
						recordViews.length,
					);
					this.setData({
						selectedPatient: patient,
						patientSessionGeneration: sessionGeneration,
						records: recordViews,
						visibleRecords: recordViews.slice(0, visibleCount),
						visibleRecordCount: visibleCount,
						hasMoreRecords: recordViews.length > visibleCount,
						queryState: recordViews.length ? "ready" : "empty",
						error: "",
						canSelectPatient: false,
					});
				});
			})
			.catch((error: unknown) => {
				if (!guard.isCurrent(token)) return;
				applyPatientContext(this, null);
				this.setData({
					records: [],
					visibleRecords: [],
					visibleRecordCount: 0,
					hasMoreRecords: false,
					patientSessionGeneration: -1,
					queryState: "error",
					sessionState: sessionStateAfterAuthenticatedReadError(
						error,
						this.data.sessionState,
						hasPlatformSession(),
					),
					error:
						error instanceof ApiError
							? "问诊记录暂不可用，请重试"
							: "问诊记录加载失败，请重试",
					canSelectPatient: false,
				});
			})
			.finally(() => {
				if (guard.isCurrent(token)) this.setData({ loading: false });
			});
	},

	onChangePatient(): void {
		if (this.data.sessionState !== "valid") {
			wx.showToast({ title: "登录状态验证中，请稍后", icon: "none" });
			return;
		}
		navigateToPatientSelector(this.data.sessionState);
	},

	onRetry(): void {
		void this.loadContext();
	},

	onLoadMore(): void {
		if (this.data.loading || !this.data.hasMoreRecords) return;
		const nextCount = Math.min(
			this.data.visibleRecordCount + CONSULTATION_PAGE_SIZE,
			this.data.records.length,
		);
		this.setData({
			visibleRecords: this.data.records.slice(0, nextCount),
			visibleRecordCount: nextCount,
			hasMoreRecords: nextCount < this.data.records.length,
		});
	},

	onUnload(): void {
		disposePageSessionResetListener(this);
		disposePageInstance(this);
	},
});
