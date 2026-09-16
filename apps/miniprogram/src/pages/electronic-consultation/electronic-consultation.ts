import { ApiError } from "../../services/api-client";
import { errorMessageWithCode } from "../../services/error-presentation";
import {
	loadLegacyElectronicConsultationRecords,
	toLegacyElectronicConsultationRecordView,
	type LegacyElectronicConsultationRecordView,
} from "../../services/electronic-consultation-legacy";
import { waitForGlobalUserProfile } from "../../services/global-user-profile";
import {
	disposePageInstance,
	getPageLatestRequestGuard,
} from "../../services/page-instance-state";
import { navigateToPatientSelector } from "../../services/patient-navigation";
import {
	patientSelectionResolutionMessage,
	preservedPatientForReload,
	registerPatientSelectionChangedListener,
	resolveStoredPatientSelection,
	shouldClearPatientContextAfterError,
} from "../../services/patient-selection-service";
import { toPatientSurfaceData } from "../../services/patient-surface-context";
import { assertSessionGeneration } from "../../services/session-boundary";
import {
	disposePageSessionResetListener,
	registerPageSessionResetListener,
} from "../../services/session-events";
import {
	getSessionGeneration,
	isCurrentSessionGeneration,
} from "../../services/session-generation";
import {
	hasPlatformSession,
	sessionStateAfterAuthenticatedReadError,
} from "../../services/session-service";
import { loadPatientsForOwner } from "../../services/dashboard-service";
import type { Patient, SessionVerificationState } from "../../types";

const RECORD_PAGE_SIZE = 8;

type ElectronicConsultationPageData = {
	hasShown: boolean;
	sessionState: SessionVerificationState;
	selectedPatient: Patient | null;
	selectedPatientName: string;
	selectedPatientIdLabel: string;
	patientSessionGeneration: number;
	records: Array<LegacyElectronicConsultationRecordView>;
	visibleRecords: Array<LegacyElectronicConsultationRecordView>;
	visibleRecordCount: number;
	hasMoreRecords: boolean;
	loading: boolean;
	error: string;
};

type ElectronicConsultationPageMethods = {
	loadContext(): Promise<void>;
	onLoadMore(): void;
	onChangePatient(): void;
	onOpenBill(): void;
	onOpenMedicalRecord(): void;
	onOpenInpatientBooking(): void;
	onRetry(): void;
	onUnload(): void;
};

const patientSelectionSubscriptions = new WeakMap<object, () => void>();

function applyPatientContext(
	page: WechatMiniprogram.Page.Instance<
		ElectronicConsultationPageData,
		ElectronicConsultationPageMethods
	>,
	patient: Patient | null,
): void {
	const surface = toPatientSurfaceData(patient);
	page.setData({
		selectedPatient: surface.currentPatient ?? null,
		selectedPatientName: surface.currentPatientName ?? "未选择就诊人",
		selectedPatientIdLabel: surface.currentPatientCardLabel ?? "请先选择就诊人",
	});
}

function visibleRecords(
	records: readonly LegacyElectronicConsultationRecordView[],
): {
	visibleRecords: LegacyElectronicConsultationRecordView[];
	visibleRecordCount: number;
	hasMoreRecords: boolean;
} {
	const visibleRecordCount = Math.min(RECORD_PAGE_SIZE, records.length);
	return {
		visibleRecords: records.slice(0, visibleRecordCount),
		visibleRecordCount,
		hasMoreRecords: visibleRecordCount < records.length,
	};
}

Page<ElectronicConsultationPageData, ElectronicConsultationPageMethods>({
	data: {
		hasShown: false,
		sessionState: "checking",
		selectedPatient: null,
		selectedPatientName: "正在获取就诊人...",
		selectedPatientIdLabel: "就诊卡信息加载中",
		patientSessionGeneration: -1,
		records: [],
		visibleRecords: [],
		visibleRecordCount: 0,
		hasMoreRecords: false,
		loading: true,
		error: "",
	},

	onLoad() {
		this.setData({ hasShown: false });
		registerPageSessionResetListener(
			this,
			() => {
				this.setData({
					sessionState: "checking",
					selectedPatient: null,
					selectedPatientName: "正在获取就诊人...",
					selectedPatientIdLabel: "就诊卡信息加载中",
					patientSessionGeneration: -1,
					records: [],
					visibleRecords: [],
					visibleRecordCount: 0,
					hasMoreRecords: false,
					loading: true,
					error: "",
				});
			},
			() => this.loadContext(),
		);
		const unsubscribePatientSelection = registerPatientSelectionChangedListener(
			(event) => {
				if (!isCurrentSessionGeneration(event.sessionGeneration)) return;
				const selectedPatient =
					event.patient && event.patient.id === event.patientId
						? event.patient
						: null;
				applyPatientContext(this, selectedPatient);
				this.setData({
					records: [],
					visibleRecords: [],
					visibleRecordCount: 0,
					hasMoreRecords: false,
					error: "",
				});
			},
		);
		patientSelectionSubscriptions.set(this, unsubscribePatientSelection);
		void this.loadContext();
	},

	onShow() {
		if (!this.data.hasShown) {
			this.setData({ hasShown: true });
			return;
		}
		void this.loadContext();
	},

	/** 复刻旧端选择就诊人后查询最近 30 天记录的主链路。 */
	loadContext(): Promise<void> {
		const guard = getPageLatestRequestGuard(this, "electronic-consultation");
		const token = guard.begin();
		const requestNow = new Date();
		const preservedPatient = preservedPatientForReload(
			this.data.selectedPatient,
		);
		const preservedSurface = toPatientSurfaceData(preservedPatient);
		let confirmedPatient: Patient | null = null;
		this.setData({
			loading: true,
			error: "",
			sessionState: "checking",
			selectedPatient: preservedSurface.currentPatient ?? null,
			selectedPatientName:
				preservedSurface.currentPatientName ?? "正在获取就诊人...",
			selectedPatientIdLabel:
				preservedSurface.currentPatientCardLabel ?? "就诊卡信息加载中",
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
						error: "请先完成微信登录验证",
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
				confirmedPatient = patient;
				applyPatientContext(this, patient);
				if (!patient) {
					this.setData({
						error: patientSelectionResolutionMessage(resolution),
						records: [],
						visibleRecords: [],
					});
					return;
				}
				const sessionGeneration = result.sessionGeneration;
				assertSessionGeneration(
					sessionGeneration,
					"Electronic consultation page session changed before records were requested",
				);
				return loadLegacyElectronicConsultationRecords(
					patient.id,
					requestNow,
					sessionGeneration,
				).then((records) => {
					assertSessionGeneration(
						sessionGeneration,
						"Electronic consultation page session changed before records were committed",
					);
					if (
						!guard.isCurrent(token) ||
						!hasPlatformSession() ||
						getSessionGeneration() !== sessionGeneration
					) {
						return;
					}
					const mappedRecords = records.map((record, index) =>
						toLegacyElectronicConsultationRecordView(record, index, token),
					);
					this.setData({
						selectedPatient: patient,
						patientSessionGeneration: sessionGeneration,
						records: mappedRecords,
						...visibleRecords(mappedRecords),
						error: "",
					});
				});
			})
			.catch((error: unknown) => {
				if (!guard.isCurrent(token)) return;
				const sessionStillPresent = hasPlatformSession();
				const shouldClearPatient = shouldClearPatientContextAfterError(
					error,
					sessionStillPresent,
				);
				applyPatientContext(
					this,
					shouldClearPatient ? null : (confirmedPatient ?? preservedPatient),
				);
				this.setData({
					records: [],
					visibleRecords: [],
					visibleRecordCount: 0,
					hasMoreRecords: false,
					sessionState: sessionStateAfterAuthenticatedReadError(
						error,
						this.data.sessionState,
						sessionStillPresent,
					),
					error:
						error instanceof ApiError
							? errorMessageWithCode(error, "电子导诊单加载失败")
							: "电子导诊单加载失败，请稍后再试",
				});
			})
			.finally(() => {
				if (guard.isCurrent(token)) this.setData({ loading: false });
			});
	},

	onLoadMore(): void {
		if (this.data.loading || !this.data.hasMoreRecords) return;
		const nextCount = Math.min(
			this.data.visibleRecordCount + RECORD_PAGE_SIZE,
			this.data.records.length,
		);
		this.setData({
			visibleRecordCount: nextCount,
			visibleRecords: this.data.records.slice(0, nextCount),
			hasMoreRecords: nextCount < this.data.records.length,
		});
	},

	onChangePatient(): void {
		if (this.data.sessionState !== "valid") {
			wx.showToast({ title: "登录状态验证中，请稍后", icon: "none" });
			return;
		}
		navigateToPatientSelector(this.data.sessionState);
	},

	/** 旧端“缴费账单”对应新端已存在的门诊费用只读页，支付写入仍关闭。 */
	onOpenBill(): void {
		wx.navigateTo({ url: "/pages/outpatient-payment/outpatient-payment" });
	},

	/** 旧端“病历查询”对应新端门诊病历安全摘要页。 */
	onOpenMedicalRecord(): void {
		wx.navigateTo({ url: "/pages/medical-record/medical-record" });
	},

	/** 旧端“住院预约”实际跳转公众号关注说明页，保留固定内部落点。 */
	onOpenInpatientBooking(): void {
		wx.navigateTo({ url: "/pages/official-account/official-account" });
	},

	onRetry(): void {
		void this.loadContext();
	},

	onUnload(): void {
		disposePageSessionResetListener(this);
		patientSelectionSubscriptions.get(this)?.();
		patientSelectionSubscriptions.delete(this);
		disposePageInstance(this);
	},
});
