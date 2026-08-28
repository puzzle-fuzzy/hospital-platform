import {
	ApiError,
	requestHealthDiseasesBySymptoms,
} from "../../services/api-client";
import { parseHealthKnowledgeSymptomIds } from "../../services/health-knowledge-view";
import {
	disposePageInstance,
	getPageLatestRequestGuard,
} from "../../services/page-instance-state";
import type { HealthKnowledgeDiseaseSummary } from "../../types";

type SearchState = "loading" | "ready" | "empty" | "error";
type SearchPageData = {
	items: HealthKnowledgeDiseaseSummary[];
	state: SearchState;
	errorMessage: string;
	disclaimer: string;
	publicationVersion: string;
	/** 保存本次查询条件，错误态重试不能依赖页面重新 onLoad。 */
	queryIds: string[];
};

type SearchPageMethods = {
	load(ids: string[]): Promise<void>;
	onDiseaseTap(event: WechatMiniprogram.TouchEvent): void;
	onRetry(): void;
	onUnload(): void;
};

function searchErrorMessage(error: unknown): string {
	if (error instanceof ApiError && error.code === "dependency-not-configured") {
		return "健康内容正在完善中，暂时无法使用";
	}
	return "健康内容暂时无法获取，请稍后再试";
}

Page<SearchPageData, SearchPageMethods>({
	data: {
		items: [],
		state: "loading",
		errorMessage: "",
		disclaimer: "",
		publicationVersion: "",
		queryIds: [],
	},

	onLoad(options: Record<string, string | undefined>) {
		const ids = parseHealthKnowledgeSymptomIds(options.ids);
		if (!ids) {
			this.setData({ state: "error", errorMessage: "缺少症状查询条件" });
			return;
		}
		this.setData({ queryIds: ids });
		void this.load(ids);
	},

	async load(ids: string[]) {
		const guard = getPageLatestRequestGuard(this, "health-knowledge-search");
		const token = guard.begin();
		// 新一轮查询开始后清空旧结果；旧疾病卡片不能在新症状条件下继续可点击。
		this.setData({ state: "loading", errorMessage: "", items: [] });
		try {
			const response = await requestHealthDiseasesBySymptoms(ids);
			if (!guard.isCurrent(token)) return;
			this.setData({
				items: response.data.items,
				state: response.data.items.length > 0 ? "ready" : "empty",
				disclaimer: response.data.publication.disclaimer,
				publicationVersion: response.data.publication.contentVersion,
			});
		} catch (error) {
			if (guard.isCurrent(token)) {
				this.setData({
					state: "error",
					errorMessage: searchErrorMessage(error),
				});
			}
		}
	},

	onDiseaseTap(event: WechatMiniprogram.TouchEvent) {
		const id = String(event.currentTarget.dataset.id ?? "");
		// 旧 WXML 事件可能在刷新或查询条件切换后才抵达；只允许打开当前
		// 结果集中的疾病引用，不能把任意 URL 参数当作内容事实。
		if (!id || !this.data.items.some((item) => item.id === id)) return;
		wx.navigateTo({
			url: `/pages/health-knowledge-detail/health-knowledge-detail?kind=disease&id=${encodeURIComponent(id)}`,
		});
	},

	/** 查询失败时复用已验证的症状 ID；不从页面文本或外部 query 重新拼接。 */
	onRetry() {
		if (this.data.state === "loading" || this.data.queryIds.length === 0)
			return;
		void this.load(this.data.queryIds);
	},

	/** 页面卸载后让未完成的内容查询失去回写资格。 */
	onUnload() {
		disposePageInstance(this);
	},
});
