import { ApiError, getCurrentUser } from "../../services/api-client";
import {
	loadCurrentPatientForOwner,
	loadInpatientEpisodes,
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
import type {
	InpatientEpisodePageData,
	InpatientEpisodeView,
} from "../../types";

const INPATIENT_STATUS_LABELS = Object.freeze({
	inpatient: "住院中",
	discharged: "已出院",
	cancelled: "已取消",
} as const);

const INPATIENT_BED_STATUS_LABELS = Object.freeze({
	in_bed: "在床",
	shared_bed: "共享床位",
	out_of_bed: "离床",
} as const);

type InpatientEpisodePageMethods = {
	loadPage(): Promise<void>;
	onChangePatient(): void;
	onRetry(): void;
	onPullDownRefresh(): void;
	onUnload(): void;
};

Page<InpatientEpisodePageData, InpatientEpisodePageMethods>({
	data: {
		hasShown: false,
		sessionState: "checking",
		selectedPatient: null,
		patientSessionGeneration: -1,
		episodes: [],
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
					selectedPatient: null,
					patientSessionGeneration: -1,
					episodes: [],
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

	/** 只读取旧服务的住院摘要；住院费用、账单和支付不在本页。 */
	loadPage(): Promise<void> {
		const guard = getPageLatestRequestGuard(this, "inpatient-episodes");
		const token = guard.begin();
		let expectedSessionGeneration = -1;
		const preservedPatient = preservedPatientForReload(
			this.data.selectedPatient,
		);
		this.setData({
			loading: true,
			error: "",
			sessionState: "checking",
			selectedPatient: preservedPatient,
			patientSessionGeneration: -1,
			episodes: [],
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
					"Inpatient episode session changed before patient context was committed",
				);
				if (!isCurrentSelectedPatient(patient.id)) return undefined;
				this.setData({
					selectedPatient: patient,
					patientSessionGeneration: expectedSessionGeneration,
				});
				return loadInpatientEpisodes(patient.id, expectedSessionGeneration);
			})
			.then((payload) => {
				if (!payload || !guard.isCurrent(token)) return;
				assertSessionGeneration(
					expectedSessionGeneration,
					"Inpatient episode session changed before episodes were committed",
				);
				const patientId = this.data.selectedPatient?.id;
				if (!patientId || !isCurrentSelectedPatient(patientId)) return;
				const episodes: InpatientEpisodeView[] = payload.items.map(
					(episode, index) => ({
						...episode,
						viewKey: `inpatient-episode-${expectedSessionGeneration}-${token}-${index}`,
						statusLabel: INPATIENT_STATUS_LABELS[episode.status],
						bedStatusLabel: episode.bedStatus
							? INPATIENT_BED_STATUS_LABELS[episode.bedStatus]
							: "",
					}),
				);
				this.setData({ episodes, error: "" });
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
						? "住院信息服务尚未开放，请稍后再试"
						: error instanceof ApiError &&
								error.code === "inpatient-episode-patient-not-found"
							? "当前就诊人暂无可查询的住院信息"
							: patientContextErrorMessage(
									error,
									"住院信息暂时无法获取，请稍后再试",
								);
				this.setData({
					sessionState: sessionStateAfterAuthenticatedReadError(
						error,
						this.data.sessionState,
						hasPlatformSession(),
					),
					selectedPatient,
					patientSessionGeneration: -1,
					episodes: [],
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

	onPullDownRefresh(): void {
		void this.loadPage().finally(() => wx.stopPullDownRefresh());
	},

	onUnload(): void {
		disposePageSessionResetListener(this);
		disposePageInstance(this);
	},
});
