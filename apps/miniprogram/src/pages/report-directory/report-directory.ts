import { ApiError, safeApiErrorMessage } from "../../services/api-client";
import { loadPatients, loadReports } from "../../services/dashboard-service";
import { resolveStoredPatientSelection } from "../../services/patient-selection-service";
import { createLatestRequestGuard } from "../../services/latest-request-guard";
import type {
	Report,
	ReportDirectoryPageData,
	ReportDirectoryView,
} from "../../types";

/** 报告目录只读阶段的页面批次大小，避免报告过多时一次性渲染整棵列表。 */
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

let isFirstShow = true;
const loadGuard = createLatestRequestGuard();

Page<ReportDirectoryPageData, ReportDirectoryPageMethods>({
	data: {
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
		isFirstShow = true;
		this.loadPage();
	},

	/** 从选择页返回后重新加载当前就诊人的报告，避免沿用旧患者结果。 */
	onShow() {
		if (isFirstShow) {
			isFirstShow = false;
			return;
		}
		this.loadPage();
	},

	/** 先确认 owner-scoped 患者，再读取平台报告目录；页面不接触 provider 患者号。 */
	loadPage(): Promise<void> {
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
		return loadPatients()
			.then((patients) => {
				if (!loadGuard.isCurrent(requestToken)) return undefined;
				const patient = resolveStoredPatientSelection(patients).patient;
				if (!patient) {
					throw new ApiError("请先登录并选择就诊人", {
						code: "patient-selection-required",
					});
				}
				this.setData({ selectedPatient: patient });
				return loadReports(patient.id);
			})
			.then((payload) => {
				if (!payload || !loadGuard.isCurrent(requestToken)) return;
				const reports = payload.items.map((report) => this.toView(report));
				const visibleReportCount = Math.min(REPORT_PAGE_SIZE, reports.length);
				this.setData({
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
		wx.navigateTo({ url: "/pages/patient-select/patient-select" });
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
		let message = fallback;
		if (error instanceof ApiError) {
			if (error.code === "dependency-not-configured") {
				message = "报告服务暂未配置完成，请联系管理员";
			} else if (error.code === "patient-selection-required") {
				message = "请先选择就诊人，再查看报告";
			} else {
				message = safeApiErrorMessage(error, fallback);
			}
		}
		this.setData({
			error: message,
			selectedPatient: null,
			reports: [],
			visibleReports: [],
		});
	},
});
