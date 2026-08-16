import {
	ApiError,
	requestReportDetail,
	safeApiErrorMessage,
} from "../../services/api-client";
import type { ReportDetailPageData, ReportTabEvent } from "../../types";

/** 报告详情页只消费服务端白名单检测项，不保存 provider 原始响应。 */
type ReportDetailPageMethods = {
	onTabChange(event: ReportTabEvent): void;
	onDownloadCloudImage(): void;
	onShareReport(): void;
	onGotoConsultation(): void;
	showError(error: unknown): void;
};

/**
 * 详情页的报告数量来自上一页已完成的目录查询；直接打开详情时不显示数量，
 * 绝不使用一个看似正常但没有服务端依据的默认值。
 */
function parseReportCount(value: string | undefined): number {
	const count = Number(value);
	return Number.isSafeInteger(count) && count > 0 ? count : 0;
}

Page<ReportDetailPageData, ReportDetailPageMethods>({
	data: {
		loading: true,
		title: "报告详情",
		reportCount: 0,
		activeTab: "report",
		reportedAt: "",
		items: [],
		hasItems: false,
		hasAttachment: false,
		error: "",
	},

	onLoad(options: Record<string, string | undefined>): void {
		const reportId = options?.reportId;
		const reportCount = parseReportCount(options?.reportCount);
		this.setData({ reportCount });
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
		const message = safeApiErrorMessage(error, "报告详情加载失败");
		this.setData({ error: message, loading: false, title: "报告详情不可用" });
		wx.showToast({ title: message, icon: "none" });
	},
});
