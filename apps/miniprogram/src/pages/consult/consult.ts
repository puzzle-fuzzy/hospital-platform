import { ApiError } from "../../services/api-client";
import {
	formatPlatformDate,
	loadAppointmentRecords,
	loadPatientsForOwner,
} from "../../services/dashboard-service";
import { waitForGlobalUserProfile } from "../../services/global-user-profile";
import { toAppointmentRecordView } from "../../services/appointment-record-view";
import {
	disposePageInstance,
	getPageLatestRequestGuard,
} from "../../services/page-instance-state";
import { navigateToPatientSelector } from "../../services/patient-navigation";
import {
	patientSelectionResolutionMessage,
	resolveStoredPatientSelection,
} from "../../services/patient-selection-service";
import { hasPlatformSession } from "../../services/session-service";
import { assertSessionGeneration } from "../../services/session-boundary";
import { getSessionGeneration } from "../../services/session-generation";
import { filterConsultRecords } from "../../services/consult-record-view";
import type {
	AppointmentRecordView,
	Patient,
	SessionVerificationState,
} from "../../types";

/** 旧端就诊页的三个固定标签；标签切换只改变展示状态，不代表已经读取实时数据。 */
const CONSULT_TABS = Object.freeze([
	{ id: "today", title: "今日就诊" },
	{ id: "upcoming", title: "未来就诊" },
	{ id: "history", title: "历史就诊" },
] as const);

type ConsultTabId = (typeof CONSULT_TABS)[number]["id"];

type ConsultPageData = {
	hasShown: boolean;
	sessionState: SessionVerificationState;
	selectedPatient: Patient | null;
	selectedPatientName: string;
	selectedPatientIdLabel: string;
	tabs: typeof CONSULT_TABS;
	activeTab: ConsultTabId;
	records: Array<AppointmentRecordView>;
	visibleRecords: Array<AppointmentRecordView>;
	loading: boolean;
	error: string;
};

type ConsultPageMethods = {
	loadContext(): Promise<void>;
	onTabTap(event: { currentTarget?: { dataset?: { tab?: string } } }): void;
	onChangePatient(): void;
	onRetry(): void;
	onUnload(): void;
};

function sessionStateFromError(error: unknown): SessionVerificationState {
	if (error instanceof ApiError && error.code === "unauthorized")
		return "invalid";
	return "unavailable";
}

function applyPatientContext(
	page: WechatMiniprogram.Page.Instance<ConsultPageData, ConsultPageMethods>,
	patient: Patient | null,
): void {
	page.setData({
		selectedPatient: patient,
		selectedPatientName: patient?.displayName || "未选择就诊人",
		selectedPatientIdLabel: patient ? `ID：${patient.id}` : "ID：----",
	});
}

/** 当前标签只在本地切换已经取得的预约读模型；today 继续由实时状态壳承载。 */
function visibleRecordsForTab(
	records: readonly AppointmentRecordView[],
	tab: ConsultTabId,
	today: string,
): Array<AppointmentRecordView> {
	if (tab === "today") return [];
	return filterConsultRecords(records, today, tab).map((record, index) => ({
		...record,
		viewKey: `consult-record-${tab}-${index}`,
	}));
}

Page<ConsultPageData, ConsultPageMethods>({
	data: {
		hasShown: false,
		sessionState: "checking",
		selectedPatient: null,
		selectedPatientName: "正在获取就诊人...",
		selectedPatientIdLabel: "ID：----",
		tabs: CONSULT_TABS,
		activeTab: "today",
		records: [],
		visibleRecords: [],
		loading: true,
		error: "",
	},

	onLoad() {
		// 主 Tab 可能被微信复用；首次 onShow 不重复 onLoad 已发起的会话读取。
		this.setData({ hasShown: false });
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
	 * 就诊页把稳定的预约历史和实时动态拆成两个生命周期。
	 * 未来/历史只读取已存在的 owner-scoped 预约摘要；今日仍不创建
	 * WebSocket，也不调用队列接口，避免把预约记录误报成实时就诊事实。
	 */
	loadContext(): Promise<void> {
		const guard = getPageLatestRequestGuard(this, "consult-context");
		const token = guard.begin();
		this.setData({
			loading: true,
			error: "",
			sessionState: "checking",
			selectedPatient: null,
			selectedPatientName: "正在获取就诊人...",
			selectedPatientIdLabel: "ID：----",
			records: [],
			visibleRecords: [],
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
				applyPatientContext(this, patient);
				const selectionMessage = patientSelectionResolutionMessage(resolution);
				if (!patient) {
					this.setData({
						error: selectionMessage,
						records: [],
						visibleRecords: [],
					});
					return;
				}

				const sessionGeneration = result.sessionGeneration;
				// 一轮读取必须固定业务日，避免请求跨越中国标准时间零点时，
				// 服务端记录和页面分组分别使用两个“今天”。
				const requestNow = new Date();
				assertSessionGeneration(
					sessionGeneration,
					"Consult page session changed before appointment records were requested",
				);
				return loadAppointmentRecords(
					patient.id,
					requestNow,
					"history",
					sessionGeneration,
					"all",
				).then((records) => {
					assertSessionGeneration(
						sessionGeneration,
						"Consult page session changed before appointment records were committed",
					);
					if (
						!guard.isCurrent(token) ||
						!hasPlatformSession() ||
						getSessionGeneration() !== sessionGeneration
					) {
						return;
					}
					const mappedRecords = records.map((record, index) =>
						toAppointmentRecordView(record, index, "consult-record", token),
					);
					const today = formatPlatformDate(requestNow);
					this.setData({
						selectedPatient: patient,
						records: mappedRecords,
						visibleRecords: visibleRecordsForTab(
							mappedRecords,
							this.data.activeTab,
							today,
						),
						error: selectionMessage,
					});
				});
			})
			.catch((error: unknown) => {
				if (!guard.isCurrent(token)) return;
				applyPatientContext(this, null);
				this.setData({
					records: [],
					visibleRecords: [],
					sessionState: sessionStateFromError(error),
					error:
						error instanceof ApiError
							? "就诊人信息暂不可用，请重试"
							: "就诊页面加载失败，请重试",
				});
			})
			.finally(() => {
				if (guard.isCurrent(token)) this.setData({ loading: false });
			});
	},

	onTabTap(event): void {
		const tab = event.currentTarget?.dataset?.tab;
		if (tab !== "today" && tab !== "upcoming" && tab !== "history") return;
		const activeTab = tab as ConsultTabId;
		const today = formatPlatformDate(new Date());
		this.setData({
			activeTab,
			visibleRecords: visibleRecordsForTab(this.data.records, activeTab, today),
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

	onUnload(): void {
		disposePageInstance(this);
	},
});
