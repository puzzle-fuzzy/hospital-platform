import { ApiError, getCurrentUser } from "../../services/api-client";
import {
	loadCurrentPatientForOwner,
	loadOutpatientMedicalRecords,
} from "../../services/dashboard-service";
import { errorMessageWithCode } from "../../services/error-presentation";
import {
	disposePageInstance,
	getPageLatestRequestGuard,
} from "../../services/page-instance-state";
import { navigateToPatientSelector } from "../../services/patient-navigation";
import {
	isCurrentSelectedPatient,
	isPatientSelectionError,
	patientContextErrorMessage,
	preservedPatientForReload,
	shouldClearPatientContextAfterError,
} from "../../services/patient-selection-service";
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
import type { MedicalRecordPageData, MedicalRecordView } from "../../types";

/** 只控制小程序渲染窗口，不把本地“加载更多”冒充成 Provider 分页。 */
const MEDICAL_RECORD_PAGE_SIZE = 8;

type MedicalRecordPageMethods = {
	loadPage(): Promise<void>;
	onChangePatient(): void;
	onRetry(): void;
	onLoadMore(): void;
	onPullDownRefresh(): void;
	onUnload(): void;
};

Page<MedicalRecordPageData, MedicalRecordPageMethods>({
	data: {
		hasShown: false,
		sessionState: "checking",
		queryState: "loading",
		selectedPatient: null,
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
				this.setData({
					sessionState: "checking",
					queryState: "loading",
					selectedPatient: null,
					patientSessionGeneration: -1,
					records: [],
					visibleRecords: [],
					visibleRecordCount: 0,
					hasMoreRecords: false,
					loading: true,
					error: "",
					canSelectPatient: false,
				});
			},
			() => this.loadPage(),
		);
		void this.loadPage();
	},

	onShow() {
		if (!this.data.hasShown) {
			this.setData({ hasShown: true });
			return;
		}
		void this.loadPage();
	},

	/**
	 * 旧端只读取当前患者近 30 天的门诊就诊摘要。病历正文、附件和住院
	 * 记录没有复用此接口，也不会由页面自行拼接 Provider 患者号。
	 */
	loadPage(): Promise<void> {
		const guard = getPageLatestRequestGuard(this, "medical-records");
		const token = guard.begin();
		let expectedSessionGeneration = -1;
		const preservedPatient = preservedPatientForReload(
			this.data.selectedPatient,
		);
		this.setData({
			loading: true,
			queryState: "loading",
			error: "",
			sessionState: "checking",
			selectedPatient: preservedPatient,
			patientSessionGeneration: -1,
			records: [],
			visibleRecords: [],
			visibleRecordCount: 0,
			hasMoreRecords: false,
			canSelectPatient: false,
		});

		return getCurrentUser()
			.then((currentUser) => {
				if (!guard.isCurrent(token)) return undefined;
				expectedSessionGeneration = getSessionGeneration();
				this.setData({ sessionState: "valid" });
				return loadCurrentPatientForOwner(currentUser.data.user.id);
			})
			.then((patientContext) => {
				if (!patientContext || !guard.isCurrent(token)) return undefined;
				expectedSessionGeneration = patientContext.sessionGeneration;
				const { patient } = patientContext;
				assertSessionGeneration(
					expectedSessionGeneration,
					"Medical record session changed before patient context was committed",
				);
				if (!isCurrentSelectedPatient(patient.id)) return undefined;
				this.setData({
					selectedPatient: patient,
					patientSessionGeneration: expectedSessionGeneration,
				});
				return loadOutpatientMedicalRecords(
					patient.id,
					new Date(),
					expectedSessionGeneration,
				);
			})
			.then((payload) => {
				if (!payload || !guard.isCurrent(token)) return;
				assertSessionGeneration(
					expectedSessionGeneration,
					"Medical record session changed before records were committed",
				);
				const patientId = this.data.selectedPatient?.id;
				if (!patientId || !isCurrentSelectedPatient(patientId)) return;
				const records: MedicalRecordView[] = payload.items.map(
					(record, index) => ({
						...record,
						viewKey: `medical-record-${expectedSessionGeneration}-${token}-${index}`,
					}),
				);
				const visibleRecordCount = Math.min(
					MEDICAL_RECORD_PAGE_SIZE,
					records.length,
				);
				this.setData({
					records,
					visibleRecords: records.slice(0, visibleRecordCount),
					visibleRecordCount,
					hasMoreRecords: visibleRecordCount < records.length,
					queryState: records.length > 0 ? "ready" : "empty",
					error: "",
				});
			})
			.catch((error: unknown) => {
				if (!guard.isCurrent(token)) return;
				const canSelectPatient = isPatientSelectionError(error);
				const clearPatient =
					shouldClearPatientContextAfterError(error, hasPlatformSession()) ||
					canSelectPatient;
				const selectedPatient = clearPatient
					? null
					: preservedPatientForReload(this.data.selectedPatient);
				const message =
					error instanceof ApiError &&
					error.code === "dependency-not-configured"
						? "门诊病历服务尚未开放，请稍后再试"
						: error instanceof ApiError &&
								error.code === "medical-record-patient-not-found"
							? "当前就诊人暂无可查询的门诊记录"
							: patientContextErrorMessage(
									error,
									"门诊病历暂时无法获取，请稍后再试",
								);
				this.setData({
					sessionState: sessionStateAfterAuthenticatedReadError(
						error,
						this.data.sessionState,
						hasPlatformSession(),
					),
					queryState: "error",
					selectedPatient,
					patientSessionGeneration: -1,
					records: [],
					visibleRecords: [],
					visibleRecordCount: 0,
					hasMoreRecords: false,
					canSelectPatient,
					error: errorMessageWithCode(error, message),
				});
			})
			.finally(() => {
				if (guard.isCurrent(token)) this.setData({ loading: false });
			});
	},

	onChangePatient(): void {
		if (this.data.sessionState !== "valid") {
			wx.showToast({ title: "请先完成登录验证", icon: "none" });
			return;
		}
		navigateToPatientSelector(this.data.sessionState);
	},

	onRetry(): void {
		void this.loadPage();
	},

	onLoadMore(): void {
		if (this.data.loading || !this.data.hasMoreRecords) return;
		const patientId = this.data.selectedPatient?.id;
		if (
			!patientId ||
			this.data.patientSessionGeneration !== getSessionGeneration() ||
			!isCurrentSelectedPatient(patientId)
		) {
			void this.loadPage();
			return;
		}
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

	onPullDownRefresh(): void {
		void this.loadPage().finally(() => wx.stopPullDownRefresh());
	},

	onUnload(): void {
		disposePageSessionResetListener(this);
		disposePageInstance(this);
	},
});
