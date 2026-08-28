import { ApiError, getCurrentUser } from "../../services/api-client";
import {
	loadCurrentPatientForOwner,
	loadReports,
} from "../../services/dashboard-service";
import { navigateToFeatureStatus } from "../../services/feature-navigation";
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
	Report,
	ReportDirectoryPageData,
	ReportDirectoryView,
	ViewKeyEvent,
} from "../../types";

/**
 * 报告目录只读阶段的本地渲染批次大小，避免报告过多时一次性渲染整棵列表。
 *
 * 当前 API 没有服务端 cursor/page；这里的分批只控制 WXML 渲染成本，不能
 * 被描述为已经完成 provider 分页，也不能改变 `payload.total` 的服务端语义。
 */
const REPORT_PAGE_SIZE = 10;

const REPORT_KIND_LABELS = Object.freeze({
	laboratory: "检验报告",
	imaging: "影像报告",
	ecg: "心电报告",
} as const);

const REPORT_STATUS_LABELS = Object.freeze({
	available: "正常",
	abnormal: "需关注",
} as const);

/**
 * 报告详情点击必须按当前渲染批次回查，而不能直接相信旧 WXML 携带的
 * `reportId`。`reportId` 是 owner-scoped 的短期详情引用；切换就诊人后，
 * 旧事件即使晚到，也不能继续把旧患者的报告带入详情页。
 */
function findVisibleReport(
	reports: readonly ReportDirectoryView[],
	viewKey: unknown,
): ReportDirectoryView | undefined {
	if (typeof viewKey !== "string" || !viewKey) return undefined;
	return reports.find((report) => report.viewKey === viewKey);
}

type ReportDirectoryPageMethods = {
	loadPage(): Promise<void>;
	onRetry(): void;
	onChangePatient(): void;
	onReportTap(event: ViewKeyEvent): void;
	onLoadMore(): void;
	onPullDownRefresh(): void;
	onUnload(): void;
	isPatientContextCurrent(): boolean;
	showError(error: unknown, fallback: string): void;
	toView(
		report: Report,
		index: number,
		renderGeneration: number,
	): ReportDirectoryView;
};

Page<ReportDirectoryPageData, ReportDirectoryPageMethods>({
	data: {
		hasShown: false,
		sessionState: "checking",
		selectedPatient: null,
		patientSessionGeneration: -1,
		reports: [],
		visibleReports: [],
		reportCount: 0,
		hasMoreReports: false,
		visibleReportCount: 0,
		loading: true,
		error: "",
		canSelectPatient: false,
	},

	onLoad() {
		// 首次展示标记必须绑定当前页面实例，避免报告页栈叠加时互相影响。
		this.setData({ hasShown: false });
		registerPageSessionResetListener(
			this,
			() => {
				// 报告摘要属于当前患者的临床读模型。会话切换后必须清除报告卡片
				// 和本地展开窗口，不能等待下一次请求完成后才撤掉旧数据。
				this.setData({
					sessionState: "checking",
					selectedPatient: null,
					patientSessionGeneration: -1,
					reports: [],
					visibleReports: [],
					reportCount: 0,
					visibleReportCount: 0,
					hasMoreReports: false,
					loading: true,
					error: "",
					canSelectPatient: false,
				});
			},
			() => this.loadPage(),
		);
		this.loadPage();
	},

	/** 从选择页返回后重新加载当前就诊人的报告，避免沿用旧患者结果。 */
	onShow() {
		if (!this.data.hasShown) {
			this.setData({ hasShown: true });
			return;
		}
		this.loadPage();
	},

	/** 先确认 owner-scoped 患者，再读取平台报告目录；页面不接触 provider 患者号。 */
	loadPage(): Promise<void> {
		const loadGuard = getPageLatestRequestGuard(this, "reports");
		const requestToken = loadGuard.begin();
		// 报告目录是 `/me`、患者和临床列表的组合读模型；所有阶段必须属于
		// 同一会话代际，不能只依赖单个请求的 HTTP 成功状态。
		let expectedSessionGeneration = -1;
		let expectedOwnerId = "";
		// 同一账号、同一明确选择的患者在刷新期间继续展示患者卡片；报告列表
		// 仍然清空并等待本轮 owner-scoped 查询，避免身份卡片闪退或旧列表串入。
		const preservedPatient = preservedPatientForReload(
			this.data.selectedPatient,
		);
		this.setData({
			loading: true,
			error: "",
			sessionState: "checking",
			selectedPatient: preservedPatient,
			patientSessionGeneration: -1,
			reports: [],
			visibleReports: [],
			reportCount: 0,
			visibleReportCount: 0,
			hasMoreReports: false,
			canSelectPatient: false,
		});
		// 报告属于患者范围业务；只有 `/me` 已验证成功，才能把“更换患者”
		// 入口视为可用，不能把请求层的自动登录隐藏成页面授权状态。
		return getCurrentUser()
			.then((currentUser) => {
				if (!loadGuard.isCurrent(requestToken)) return undefined;
				expectedOwnerId = currentUser.data.user.id;
				expectedSessionGeneration = getSessionGeneration();
				this.setData({ sessionState: "valid" });
				return loadCurrentPatientForOwner(expectedOwnerId);
			})
			.then((patientContext) => {
				if (!patientContext) return undefined;
				expectedSessionGeneration = patientContext.sessionGeneration;
				const { patient } = patientContext;
				assertSessionGeneration(
					expectedSessionGeneration,
					"Report directory session changed before patient context was committed",
				);
				if (
					!loadGuard.isCurrent(requestToken) ||
					!isCurrentSelectedPatient(patient.id)
				) {
					return undefined;
				}
				// 业务列表请求前也要检查最新代际，避免账号刚切换时把
				// 上一轮患者 ID 带入报告查询；响应后的断言仍不可省略。
				assertSessionGeneration(
					expectedSessionGeneration,
					"Report directory session changed before reports were requested",
				);
				// 患者卡片必须和同一轮报告目录一起提交；只确认目录患者后就
				// 先展示卡片，会在切换患者或报告请求失败时形成错误的上下文暗示。
				return loadReports(
					patient.id,
					new Date(),
					expectedSessionGeneration,
				).then((payload) => {
					assertSessionGeneration(
						expectedSessionGeneration,
						"Report directory session changed before reports were committed",
					);
					return { patient, payload };
				});
			})
			.then((result) => {
				if (
					!result ||
					!loadGuard.isCurrent(requestToken) ||
					!isCurrentSelectedPatient(result.patient.id)
				) {
					return;
				}
				const { patient, payload } = result;
				const reports = payload.items.map((report, index) =>
					this.toView(report, index, requestToken),
				);
				const visibleReportCount = Math.min(REPORT_PAGE_SIZE, reports.length);
				this.setData({
					selectedPatient: patient,
					patientSessionGeneration: expectedSessionGeneration,
					reports,
					visibleReports: reports.slice(0, visibleReportCount),
					reportCount: payload.total,
					visibleReportCount,
					hasMoreReports: visibleReportCount < reports.length,
					error: "",
					canSelectPatient: false,
				});
			})
			.catch((error) => {
				if (loadGuard.isCurrent(requestToken)) {
					this.setData({
						sessionState: sessionStateAfterAuthenticatedReadError(
							error,
							this.data.sessionState,
							hasPlatformSession(),
						),
					});
				}
				if (loadGuard.isCurrent(requestToken)) {
					this.showError(error, "报告目录加载失败");
				}
			})
			.finally(() => {
				if (loadGuard.isCurrent(requestToken)) this.setData({ loading: false });
			});
	},

	onChangePatient(): void {
		navigateToPatientSelector(this.data.sessionState);
	},

	/**
	 * 报告错误态的重试重新建立患者范围目录；不能只把 error 置空，
	 * 否则页面会在没有新 Provider 结果时短暂呈现上一轮或伪造的空目录。
	 */
	onRetry(): void {
		void this.loadPage();
	},

	/**
	 * 详情页只接受当前渲染批次回查出的短期 opaque reportId；摘要没有引用，
	 * 或事件来自患者切换前的旧 WXML 时，保持不可点击并阻断越权式串页。
	 */
	onReportTap(event): void {
		const report = findVisibleReport(
			this.data.visibleReports,
			event.currentTarget?.dataset?.viewKey,
		);
		if (!report) {
			// 事件可能来自患者切换或刷新前的旧 WXML。找不到当前渲染批次
			// 的报告时必须静默丢弃，不能把失效点击误判为“详情未开放”，
			// 更不能让旧事件获得任何详情路由资格。
			return;
		}
		const patientId = this.data.selectedPatient?.id;
		if (typeof patientId !== "string" || !patientId) {
			// 患者上下文丢失时不能只凭旧 reportId 进入详情；返回目录重新选择，
			// 让服务端的 owner + patient + reportId 三重校验保持完整。
			wx.showToast({ title: "请先选择就诊人", icon: "none" });
			return;
		}
		if (!this.isPatientContextCurrent()) {
			// 另一个页面可能已经切换了就诊人，但旧报告卡片的事件仍然晚到。
			// 这里先在客户端阻断旧 patientId，避免把合法但属于上一位患者的
			// opaque 详情引用带入详情页；服务端 owner 校验仍是最后一道边界。
			wx.showToast({ title: "当前就诊人已变化，请重新加载", icon: "none" });
			return;
		}
		const reportId = report.reportId;
		if (typeof reportId !== "string" || !reportId) {
			// 当前报告确实存在，但服务端没有发放短期详情引用时，才进入
			// 功能关闭态；这和“旧事件找不到报告”是两种不同的业务结果。
			navigateToFeatureStatus("report-detail");
			return;
		}
		wx.navigateTo({
			url: `/pages/report-detail/report-detail?patientId=${encodeURIComponent(patientId)}&reportId=${encodeURIComponent(reportId)}&reportCount=${this.data.reportCount}`,
		});
	},

	onLoadMore(): void {
		// 报告目录的“加载更多”只改变已取得读模型的本地窗口。刷新、
		// 患者切换或初次加载期间没有稳定的当前窗口，旧事件必须直接失效。
		if (this.data.loading || !this.data.selectedPatient) return;
		if (!this.isPatientContextCurrent()) {
			// 报告分页只改变本地窗口，但窗口仍属于患者范围读模型；会话
			// 漂移时必须先重建目录，不能把旧报告继续暴露给新会话。
			void this.loadPage();
			return;
		}
		if (!this.data.hasMoreReports) return;
		const nextCount = Math.min(
			this.data.visibleReportCount + REPORT_PAGE_SIZE,
			this.data.reports.length,
		);
		if (nextCount <= this.data.visibleReportCount) return;
		this.setData({
			visibleReports: this.data.reports.slice(0, nextCount),
			visibleReportCount: nextCount,
			hasMoreReports: nextCount < this.data.reports.length,
		});
	},

	onPullDownRefresh(): void {
		this.loadPage().finally(() => wx.stopPullDownRefresh());
	},

	/** 页面卸载后让报告目录请求失去回写资格。 */
	onUnload(): void {
		disposePageSessionResetListener(this);
		disposePageInstance(this);
	},

	/** 报告目录和详情入口必须同时满足患者选择与会话代际门禁。 */
	isPatientContextCurrent(): boolean {
		const patientId = this.data.selectedPatient?.id;
		return (
			typeof patientId === "string" &&
			this.data.patientSessionGeneration === getSessionGeneration() &&
			isCurrentSelectedPatient(patientId)
		);
	},

	toView(
		report: Report,
		index: number,
		renderGeneration: number,
	): ReportDirectoryView {
		return {
			...report,
			kindLabel: REPORT_KIND_LABELS[report.kind],
			statusLabel: REPORT_STATUS_LABELS[report.status],
			// 该 key 只用于 WXML diff 和事件回查，严禁当作 provider 报告号使用。
			viewKey: `report-${renderGeneration}-${index}`,
		};
	},

	showError(error: unknown, _fallback: string): void {
		const message =
			error instanceof ApiError && error.code === "dependency-not-configured"
				? "报告服务正在完善中，暂时无法使用"
				: patientContextErrorMessage(error, "检查报告暂时无法获取，请稍后再试");
		const canSelectPatient = isPatientSelectionError(error);
		const clearPatient =
			shouldClearPatientContextAfterError(error, hasPlatformSession()) ||
			canSelectPatient;
		const preservedPatient = clearPatient
			? null
			: preservedPatientForReload(this.data.selectedPatient);
		this.setData({
			error: message,
			// 只有明确的患者上下文错误才允许错误态引导换人；网络、Provider、
			// 持久化和依赖配置失败只保留重试，避免把服务故障误判成未选患者。
			canSelectPatient,
			// 服务异常只影响报告查询，不代表已确认的患者消失；会话失效或
			// 明确的患者选择错误才清除卡片并提供重新选择入口。
			selectedPatient: preservedPatient,
			patientSessionGeneration: -1,
			reports: [],
			visibleReports: [],
			// 计数和分页标记都是同一份临床列表读模型的派生状态；请求失败
			// 时必须与列表一起清空，避免页面显示旧总数或继续加载旧报告。
			reportCount: 0,
			visibleReportCount: 0,
			hasMoreReports: false,
		});
	},
});
