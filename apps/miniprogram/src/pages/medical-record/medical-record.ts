import { ApiError, safeApiErrorMessage } from "../../services/api-client";
import {
	loadOutpatientMedicalRecords,
	loadPatientsForOwner,
} from "../../services/dashboard-service";
import { waitForGlobalUserProfile } from "../../services/global-user-profile";
import {
	disposePageInstance,
	getPageLatestRequestGuard,
} from "../../services/page-instance-state";
import { navigateToPatientSelector } from "../../services/patient-navigation";
import {
	isPatientSelectionError,
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
import type {
	MedicalRecordPageData,
	MedicalRecordView,
	Patient,
} from "../../types";

/** 只控制小程序渲染窗口，不把本地“加载更多”冒充成 Provider 分页。 */
const MEDICAL_RECORD_PAGE_SIZE = 8;

type MedicalRecordPageMethods = {
	loadContext(): Promise<void>;
	onChangePatient(): void;
	onRetry(): void;
	onLoadMore(): void;
	onUnload(): void;
};

function applyPatientContext(
	page: WechatMiniprogram.Page.Instance<
		MedicalRecordPageData,
		MedicalRecordPageMethods
	>,
	patient: Patient | null,
): void {
	const surface = toPatientSurfaceData(patient);
	page.setData({
		selectedPatient: surface.currentPatient ?? null,
		selectedPatientName: surface.currentPatientName ?? "未选择就诊人",
		selectedPatientCardLabel:
			surface.currentPatientCardLabel ?? "请先选择就诊人",
	});
}

Page<MedicalRecordPageData, MedicalRecordPageMethods>({
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
		registerPageSessionResetListener(
			this,
			() => {
				// 账号切换必须立即清掉上一账号的病历摘要，不能等待下一次
				// Provider 请求完成后才隐藏旧患者内容。
				this.setData({
					sessionState: "checking",
					selectedPatient: null,
					selectedPatientName: "正在获取就诊人...",
					selectedPatientCardLabel: "就诊卡信息加载中",
					patientSessionGeneration: -1,
					records: [],
					visibleRecords: [],
					visibleRecordCount: 0,
					hasMoreRecords: false,
					loading: true,
					queryState: "loading",
					error: "",
					canSelectPatient: false,
				});
			},
			() => this.loadContext(),
		);
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
	 * 复刻旧端 electronic_record.vue 的实际行为：查询当前患者近 30 天
	 * 的门诊就诊记录。它是独立病历目录，不复用报告、预约或电子导诊单。
	 */
	loadContext(): Promise<void> {
		const guard = getPageLatestRequestGuard(this, "medical-record-context");
		const token = guard.begin();
		this.setData({
			loading: true,
			queryState: "loading",
			error: "",
			canSelectPatient: false,
			sessionState: "checking",
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
					});
					return undefined;
				}
				this.setData({ sessionState: "valid" });
				return loadPatientsForOwner(profileState.ownerId);
			})
			.then((result) => {
				if (!result || !guard.isCurrent(token)) return undefined;
				const resolution = resolveStoredPatientSelection(result.patients);
				const patient = resolution.patient ?? null;
				applyPatientContext(this, patient);
				if (!patient) {
					this.setData({
						queryState: "error",
						canSelectPatient:
							resolution.state !== "selected" &&
							resolution.state !== "defaulted",
						error: patientSelectionResolutionMessage(resolution),
					});
					return undefined;
				}

				const sessionGeneration = result.sessionGeneration;
				assertSessionGeneration(
					sessionGeneration,
					"Medical record session changed before records were requested",
				);
				return loadOutpatientMedicalRecords(
					patient.id,
					new Date(),
					sessionGeneration,
				).then((payload) => {
					assertSessionGeneration(
						sessionGeneration,
						"Medical record session changed before records were committed",
					);
					return { patient, payload, sessionGeneration };
				});
			})
			.then((result) => {
				if (
					!result ||
					!guard.isCurrent(token) ||
					!hasPlatformSession() ||
					getSessionGeneration() !== result.sessionGeneration
				)
					return;
				const recordViews: Array<MedicalRecordView> = result.payload.items.map(
					(record, index) => ({
						...record,
						// 页面 diff 键不承载病历号；Provider 主键在 adapter 已被丢弃。
						viewKey: `medical-record-${token}-${index}`,
					}),
				);
				const visibleRecordCount = Math.min(
					MEDICAL_RECORD_PAGE_SIZE,
					recordViews.length,
				);
				this.setData({
					selectedPatient: result.patient,
					patientSessionGeneration: result.sessionGeneration,
					records: recordViews,
					visibleRecords: recordViews.slice(0, visibleRecordCount),
					visibleRecordCount,
					hasMoreRecords: visibleRecordCount < recordViews.length,
					queryState: recordViews.length ? "ready" : "empty",
					canSelectPatient: false,
					error: "",
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
					canSelectPatient: isPatientSelectionError(error),
					sessionState: sessionStateAfterAuthenticatedReadError(
						error,
						this.data.sessionState,
						hasPlatformSession(),
					),
					error:
						error instanceof ApiError
							? safeApiErrorMessage(error, "门诊病历暂时无法获取，请稍后再试")
							: "门诊病历暂时无法获取，请稍后再试",
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
			this.data.visibleRecordCount + MEDICAL_RECORD_PAGE_SIZE,
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
