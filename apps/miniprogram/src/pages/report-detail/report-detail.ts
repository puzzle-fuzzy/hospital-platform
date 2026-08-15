import { ApiError, requestReportDetail } from "../../services/api-client";
import type { ReportDetailPageData, ReportTabEvent } from "../../types";

/** 报告详情页只消费服务端白名单检测项，不保存 provider 原始响应。 */
type ReportDetailPageMethods = {
	onTabChange(event: ReportTabEvent): void;
	onDownloadCloudImage(): void;
	onShareReport(): void;
	onGotoConsultation(): void;
	showError(error: unknown): void;
};

Page<ReportDetailPageData, ReportDetailPageMethods>({
	data: {
		loading: true,
		title: "报告详情",
		reportCount: 1,
		activeTab: "report",
		reportedAt: "",
		items: [],
		hasItems: false,
		hasAttachment: false,
		error: "",
	},

	onLoad(options: Record<string, string | undefined>): void {
		const reportId = options?.reportId;
		if (typeof reportId !== "string" || !reportId) {
			this.showError(
				new ApiError("报告详情引用无效", { code: "report-detail-id-missing" }),
			);
			return;
		}

		requestReportDetail(reportId)
			.then((payload) => {
				const report = payload?.data;
				if (!report) {
					throw new ApiError("服务端未返回报告详情", {
						code: "report-detail-response-missing",
					});
				}
				const items = report.items || [];
				this.setData({
					title: report.title,
					reportCount: 1,
					reportedAt: report.reportedAt,
					items,
					hasItems: items.length > 0,
					hasAttachment: report.hasAttachment,
					error: "",
				});
			})
			.catch((error) => this.showError(error))
			.finally(() => this.setData({ loading: false }));
	},

	onTabChange(event: ReportTabEvent): void {
		const tab = event.currentTarget?.dataset?.tab;
		if (tab !== "report" && tab !== "image") return;
		this.setData({ activeTab: tab });
	},

	onDownloadCloudImage() {
		wx.showToast({ title: "云影像功能迁移中", icon: "none" });
	},

	onShareReport() {
		wx.showToast({ title: "分享功能迁移中", icon: "none" });
	},

	onGotoConsultation() {
		wx.showToast({ title: "复诊功能迁移中", icon: "none" });
	},

	showError(error: unknown): void {
		const message =
			error instanceof ApiError ? error.message : "报告详情加载失败";
		this.setData({ error: message, loading: false, title: "报告详情不可用" });
		wx.showToast({ title: message, icon: "none" });
	},
});
