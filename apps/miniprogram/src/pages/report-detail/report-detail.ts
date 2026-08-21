import {
	ApiError,
	getCurrentUser,
	requestReportDetail,
} from "../../services/api-client";
import { loadCurrentPatientForOwner } from "../../services/dashboard-service";
import {
	disposePageInstance,
	getPageLatestRequestGuard,
} from "../../services/page-instance-state";
import {
	isCurrentSelectedPatient,
	patientContextErrorMessage,
} from "../../services/patient-selection-service";
import { toLaboratoryReportItemView } from "../../services/report-presenter";
import { assertSessionGeneration } from "../../services/session-boundary";
import { getSessionGeneration } from "../../services/session-generation";
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
		// 详情页可能被旧页面栈或手工深链直接打开，不能只相信 URL 中的
		// patientId。先重新取得当前 owner，再读取其患者目录；这样即使本地
		// selected_patient_id 仍是旧账号的值，也不会直接把引用送进详情 API。
		let expectedSessionGeneration = -1;
		let expectedOwnerId = "";
		getCurrentUser()
			.then((currentUser) => {
				if (!detailGuard.isCurrent(detailToken)) return undefined;
				expectedOwnerId = currentUser.data.user.id;
				expectedSessionGeneration = getSessionGeneration();
				return loadCurrentPatientForOwner(expectedOwnerId);
			})
			.then((patientContext) => {
				if (!patientContext || !detailGuard.isCurrent(detailToken))
					return undefined;
				expectedSessionGeneration = patientContext.sessionGeneration;
				const { patient: currentPatient } = patientContext;
				assertSessionGeneration(
					expectedSessionGeneration,
					"Report detail session changed before patient context was confirmed",
				);
				if (
					currentPatient.id !== patientId ||
					!isCurrentSelectedPatient(patientId)
				) {
					throw new ApiError("当前就诊人已变更，请重新选择后查看报告", {
						code: "patient-selection-required",
					});
				}
				// 详情请求会携带 opaque patientId；在发出前再确认组合读取
				// 的 owner 代际，避免旧深链在账号切换窗口进入服务端。
				assertSessionGeneration(
					expectedSessionGeneration,
					"Report detail session changed before detail was requested",
				);
				return requestReportDetail({ patientId, reportId });
			})
			.then((payload) => {
				if (!payload || !detailGuard.isCurrent(detailToken)) return;
				assertSessionGeneration(
					expectedSessionGeneration,
					"Report detail session changed before detail was committed",
				);
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
				// API client 已经校验 data、reportId、kind、检测项和附件字段；
				// 这里不能把缺失检测项的损坏响应伪装成空报告。
				const report = payload.data;
				// API 只返回稳定枚举；页面在这里转换为患者可读的中文，
				// 不把展示文案反向写回服务端事实。
				const items = report.items.map(toLaboratoryReportItemView);
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
		// 报告详情虽然不是目录列表页，但仍然属于当前患者范围业务；
		// 患者失效、切换或临床映射错误必须和其它患者页面使用同一套中文
		// 错误语义，不能因为详情页单独调用通用翻译而产生文案漂移。
		const message = patientContextErrorMessage(error, "报告详情加载失败");
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
