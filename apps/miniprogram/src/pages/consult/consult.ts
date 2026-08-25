import { ApiError } from "../../services/api-client";
import { loadPatientsForOwner } from "../../services/dashboard-service";
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
import { hasPlatformSession } from "../../services/session-service";
import type { Patient, SessionVerificationState } from "../../types";

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

Page<ConsultPageData, ConsultPageMethods>({
	data: {
		hasShown: false,
		sessionState: "checking",
		selectedPatient: null,
		selectedPatientName: "正在获取就诊人...",
		selectedPatientIdLabel: "ID：----",
		tabs: CONSULT_TABS,
		activeTab: "today",
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
	 * 就诊页只加载当前 owner 的患者读模型，不加载旧端 WebSocket。
	 * 旧实现把 WebSocket、历史预约和患者缓存混在同一个生命周期里，
	 * 容易在切换患者后继续显示上一位患者的队列消息。本轮先把页面级
	 * 会话/患者快照和稳定空态迁移完整，实时 contract 冻结后再接入。
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
				applyPatientContext(this, resolution.patient ?? null);
				this.setData({ error: patientSelectionResolutionMessage(resolution) });
			})
			.catch((error: unknown) => {
				if (!guard.isCurrent(token)) return;
				applyPatientContext(this, null);
				this.setData({
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
		this.setData({ activeTab: tab });
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
