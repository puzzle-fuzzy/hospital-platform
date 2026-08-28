import { ApiError } from "../../services/api-client";
import { toAppointmentRecordView } from "../../services/appointment-record-view";
import { getConsultRecordWindow } from "../../services/consult-record-view";
import {
	formatPlatformDate,
	loadAppointmentRecords,
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
	shouldClearPatientContextAfterError,
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
	AppointmentRecordView,
	Patient,
	SessionVerificationState,
} from "../../types";

/** 旧端就诊页的三个固定标签；标签切换只改变预约摘要窗口，不代表已经读取实时数据。 */
const CONSULT_TABS = Object.freeze([
	{ id: "today", title: "今日就诊" },
	{ id: "upcoming", title: "未来就诊" },
	{ id: "history", title: "历史就诊" },
] as const);

type ConsultTabId = (typeof CONSULT_TABS)[number]["id"];

/** 就诊页只分批展开已取得的摘要，避免历史记录过多时一次性创建大量 WXML 节点。 */
const CONSULT_RECORD_PAGE_SIZE = 8;

type ConsultPageData = {
	hasShown: boolean;
	sessionState: SessionVerificationState;
	selectedPatient: Patient | null;
	selectedPatientName: string;
	selectedPatientIdLabel: string;
	tabs: typeof CONSULT_TABS;
	activeTab: ConsultTabId;
	/** 本轮预约历史读取对应的中国标准时间业务日，标签切换期间保持不变。 */
	businessDate: string;
	records: Array<AppointmentRecordView>;
	visibleRecords: Array<AppointmentRecordView>;
	visibleRecordCount: number;
	hasMoreRecords: boolean;
	loading: boolean;
	error: string;
};

type ConsultPageMethods = {
	loadContext(): Promise<void>;
	onTabTap(event: { currentTarget?: { dataset?: { tab?: string } } }): void;
	onLoadMore(): void;
	onChangePatient(): void;
	onRetry(): void;
	onUnload(): void;
};

function applyPatientContext(
	page: WechatMiniprogram.Page.Instance<ConsultPageData, ConsultPageMethods>,
	patient: Patient | null,
): void {
	const surface = toPatientSurfaceData(patient);
	page.setData({
		selectedPatient: surface.currentPatient ?? null,
		selectedPatientName: surface.currentPatientName ?? "未选择就诊人",
		// 就诊页只展示服务端已经脱敏的卡号。内部 opaque patientId 只用于
		// 当前请求和 owner 作用域校验，不能因为页面仍沿用旧端“ID”文案而
		// 进入 WXML、截图或用户转发内容。
		selectedPatientIdLabel: surface.currentPatientCardLabel ?? "请先选择就诊人",
	});
}

Page<ConsultPageData, ConsultPageMethods>({
	data: {
		hasShown: false,
		sessionState: "checking",
		selectedPatient: null,
		selectedPatientName: "正在获取就诊人...",
		selectedPatientIdLabel: "就诊卡信息加载中",
		tabs: CONSULT_TABS,
		activeTab: "today",
		businessDate: "",
		records: [],
		visibleRecords: [],
		visibleRecordCount: 0,
		hasMoreRecords: false,
		loading: true,
		error: "",
	},

	onLoad() {
		// 主 Tab 可能被微信复用；首次 onShow 不重复 onLoad 已发起的会话读取。
		this.setData({ hasShown: false });
		registerPageSessionResetListener(
			this,
			() => {
				// 就诊记录是当前账号/当前患者的组合读模型。账号切换时必须
				// 同时清空患者摘要和三类记录，不能等 onShow 才撤销旧医疗信息。
				this.setData({
					sessionState: "checking",
					selectedPatient: null,
					selectedPatientName: "正在获取就诊人...",
					selectedPatientIdLabel: "就诊卡信息加载中",
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
		// 患者目录确认和下游业务查询是两个独立阶段。记录查询失败时保留
		// 这份快照，只有会话失效才允许在 catch 中清空患者卡片。
		let confirmedPatient: Patient | null = null;
		// 服务端查询范围和客户端标签分组必须共享同一时间快照。请求即使
		// 跨过零点完成，也不能让同一批记录在页面停留期间改变归属。
		const requestNow = new Date();
		const businessDate = formatPlatformDate(requestNow);
		this.setData({
			loading: true,
			error: "",
			sessionState: "checking",
			selectedPatient: null,
			selectedPatientName: "正在获取就诊人...",
			selectedPatientIdLabel: "就诊卡信息加载中",
			businessDate,
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
					const activeTab = this.data.activeTab;
					const initialWindow = getConsultRecordWindow(
						mappedRecords,
						activeTab,
						businessDate,
						CONSULT_RECORD_PAGE_SIZE,
					);
					const visibleRecordCount = Math.min(
						CONSULT_RECORD_PAGE_SIZE,
						initialWindow.totalRecords,
					);
					this.setData({
						selectedPatient: patient,
						records: mappedRecords,
						visibleRecords: initialWindow.visibleRecords,
						visibleRecordCount,
						hasMoreRecords: initialWindow.hasMoreRecords,
						error: selectionMessage,
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
				applyPatientContext(this, shouldClearPatient ? null : confirmedPatient);
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
							? "就诊记录暂时无法获取，请稍后再试"
							: "就诊记录暂时无法获取，请稍后再试",
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
		const window = getConsultRecordWindow(
			this.data.records,
			activeTab,
			this.data.businessDate,
			CONSULT_RECORD_PAGE_SIZE,
		);
		const visibleRecordCount = Math.min(
			CONSULT_RECORD_PAGE_SIZE,
			window.totalRecords,
		);
		this.setData({
			activeTab,
			visibleRecordCount,
			visibleRecords: window.visibleRecords,
			hasMoreRecords: window.hasMoreRecords,
		});
	},

	/** 只展开当前患者已经取得的摘要，不重复调用 Provider。 */
	onLoadMore(): void {
		if (this.data.loading || !this.data.hasMoreRecords) return;
		const nextCount = this.data.visibleRecordCount + CONSULT_RECORD_PAGE_SIZE;
		const window = getConsultRecordWindow(
			this.data.records,
			this.data.activeTab,
			this.data.businessDate,
			nextCount,
		);
		this.setData({
			visibleRecordCount: Math.min(nextCount, window.totalRecords),
			visibleRecords: window.visibleRecords,
			hasMoreRecords: window.hasMoreRecords,
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
		disposePageSessionResetListener(this);
		disposePageInstance(this);
	},
});
