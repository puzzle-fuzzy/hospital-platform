import {
	ApiError,
	requestReportDetail,
	safeApiErrorMessage,
} from "../../services/api-client";
import {
	disposePageInstance,
	getPageLatestRequestGuard,
} from "../../services/page-instance-state";
import { isCurrentSelectedPatient } from "../../services/patient-selection-service";
import { toLaboratoryReportItemView } from "../../services/report-presenter";
import type { ReportDetailPageData, ReportTabEvent } from "../../types";

/** 报告详情页只消费服务端白名单检测项，不保存 provider 原始响应。 */
type ReportDetailPageMethods = {
	onTabChange(event: ReportTabEvent): void;
	onDownloadCloudImage(): void;
	onShareReport(): void;
	onGotoConsultation(): void;
	onUnload(): void;
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
		const patientId = options?.patientId;
		const reportId = options?.reportId;
		const reportCount = parseReportCount(options?.reportCount);
		this.setData({ reportCount });
		if (
			typeof patientId !== "string" ||
			!patientId ||
			typeof reportId !== "string" ||
			!reportId
		) {
			this.showError(
				new ApiError("报告详情引用无效", { code: "report-detail-id-missing" }),
			);
			return;
		}
		// 服务端仍会再次校验 owner + patientId + reportId + TTL；这里的客户端门禁
		// 不是授权替代品，而是阻止旧页面栈/手工深链在当前设备已经切换患者后，
		// 继续展示另一位患者的合法详情。详情页只能消费当前本地明确选择的患者。
		if (!isCurrentSelectedPatient(patientId)) {
			this.showError(
				new ApiError("当前就诊人已变更，请重新选择后查看报告", {
					code: "patient-selection-required",
				}),
			);
			return;
		}

		const detailGuard = getPageLatestRequestGuard(this, "report-detail");
		const detailToken = detailGuard.begin();
		requestReportDetail({ patientId, reportId })
			.then((payload) => {
				if (!detailGuard.isCurrent(detailToken)) return;
				// 请求等待期间可能从另一个页面切换了患者；即使服务端响应合法，
				// 也不能把旧患者的详情写入当前页面。服务端 owner/patient 校验和
				// 这里的本地选择校验分别承担授权与展示隔离，两层都不能省略。
				if (!isCurrentSelectedPatient(patientId)) {
					this.showError(
						new ApiError("当前就诊人已变更，请重新选择后查看报告", {
							code: "patient-selection-required",
						}),
					);
					return;
				}
				const report = payload?.data;
				if (!report) {
					throw new ApiError("服务端未返回报告详情", {
						code: "report-detail-response-missing",
					});
				}
				// API 只返回稳定枚举；页面在这里转换为患者可读的中文，
				// 不把展示文案反向写回服务端事实。
				const items = (report.items || []).map(toLaboratoryReportItemView);
				this.setData({
					title: report.title,
					reportedAt: report.reportedAt,
					items,
					hasItems: items.length > 0,
					hasAttachment: report.hasAttachment,
					error: "",
				});
			})
			.catch((error) => {
				if (detailGuard.isCurrent(detailToken)) this.showError(error);
			})
			.finally(() => {
				if (detailGuard.isCurrent(detailToken)) {
					this.setData({ loading: false });
				}
			});
	},

	/** 页面卸载后让报告详情请求失去回写资格。 */
	onUnload(): void {
		disposePageInstance(this);
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
		// 报告详情属于当前患者的一次性临床读模型。错误、患者切换或引用过期
		// 时，上一轮检测项、报告时间和附件标记都不再有当前请求的证据；即使
		// WXML 当前会隐藏详情区域，也必须把页面状态本身收敛为空，避免未来重试
		// 或页面复用时把旧患者的临床结果重新展示出来。
		this.setData({
			error: message,
			loading: false,
			title: "报告详情不可用",
			reportedAt: "",
			items: [],
			hasItems: false,
			hasAttachment: false,
		});
		wx.showToast({ title: message, icon: "none" });
	},
});
