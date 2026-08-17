import { ApiError } from "../../services/api-client";
import {
	loadCurrentPatient,
	loadReports,
} from "../../services/dashboard-service";
import { getPageLatestRequestGuard } from "../../services/page-instance-state";
import { navigateToPatientSelector } from "../../services/patient-navigation";
import {
	isCurrentSelectedPatient,
	patientContextErrorMessage,
} from "../../services/patient-selection-service";
import type {
	Report,
	ReportDirectoryPageData,
	ReportDirectoryView,
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

type ReportDirectoryPageMethods = {
	loadPage(): Promise<void>;
	onChangePatient(): void;
	onReportTap(event: WechatMiniprogram.TouchEvent): void;
	onLoadMore(): void;
	onPullDownRefresh(): void;
	showError(error: unknown, fallback: string): void;
	toView(report: Report): ReportDirectoryView;
};

Page<ReportDirectoryPageData, ReportDirectoryPageMethods>({
	data: {
		hasShown: false,
		selectedPatient: null,
		reports: [],
		visibleReports: [],
		reportCount: 0,
		hasMoreReports: false,
		visibleReportCount: 0,
		loading: true,
		error: "",
	},

	onLoad() {
		// 首次展示标记必须绑定当前页面实例，避免报告页栈叠加时互相影响。
		this.setData({ hasShown: false });
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
		// 切换患者后先清掉旧患者的结果，避免新请求期间出现患者和列表不一致。
		this.setData({
			loading: true,
			error: "",
			selectedPatient: null,
			reports: [],
			visibleReports: [],
			reportCount: 0,
			visibleReportCount: 0,
			hasMoreReports: false,
		});
		return loadCurrentPatient()
			.then((patient) => {
				if (
					!loadGuard.isCurrent(requestToken) ||
					!isCurrentSelectedPatient(patient.id)
				) {
					return undefined;
				}
				// 患者卡片必须和同一轮报告目录一起提交；只确认目录患者后就
				// 先展示卡片，会在切换患者或报告请求失败时形成错误的上下文暗示。
				return loadReports(patient.id).then((payload) => ({
					patient,
					payload,
				}));
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
				const reports = payload.items.map((report) => this.toView(report));
				const visibleReportCount = Math.min(REPORT_PAGE_SIZE, reports.length);
				this.setData({
					selectedPatient: patient,
					reports,
					visibleReports: reports.slice(0, visibleReportCount),
					reportCount: payload.total,
					visibleReportCount,
					hasMoreReports: visibleReportCount < reports.length,
					error: "",
				});
			})
			.catch((error) => {
				if (loadGuard.isCurrent(requestToken)) {
					this.showError(error, "报告目录加载失败");
				}
			})
			.finally(() => {
				if (loadGuard.isCurrent(requestToken)) this.setData({ loading: false });
			});
	},

	onChangePatient(): void {
		navigateToPatientSelector();
	},

	/** 详情页只接受服务端生成的短期 opaque reportId，摘要没有引用时保持不可点击。 */
	onReportTap(event): void {
		const reportId = event.currentTarget?.dataset?.reportId;
		if (typeof reportId !== "string" || !reportId) {
			wx.showToast({ title: "该报告详情暂未开放", icon: "none" });
			return;
		}
		wx.navigateTo({
			url: `/pages/report-detail/report-detail?reportId=${encodeURIComponent(reportId)}&reportCount=${this.data.reportCount}`,
		});
	},

	onLoadMore(): void {
		const nextCount = Math.min(
			this.data.visibleReportCount + REPORT_PAGE_SIZE,
			this.data.reports.length,
		);
		this.setData({
			visibleReports: this.data.reports.slice(0, nextCount),
			visibleReportCount: nextCount,
			hasMoreReports: nextCount < this.data.reports.length,
		});
	},

	onPullDownRefresh(): void {
		this.loadPage().finally(() => wx.stopPullDownRefresh());
	},

	toView(report: Report): ReportDirectoryView {
		return {
			...report,
			kindLabel: REPORT_KIND_LABELS[report.kind],
			statusLabel: REPORT_STATUS_LABELS[report.status],
		};
	},

	showError(error: unknown, fallback: string): void {
		const message =
			error instanceof ApiError && error.code === "dependency-not-configured"
				? "报告服务暂未配置完成，请联系管理员"
				: patientContextErrorMessage(error, fallback);
		this.setData({
			error: message,
			selectedPatient: null,
			reports: [],
			visibleReports: [],
		});
	},
});
