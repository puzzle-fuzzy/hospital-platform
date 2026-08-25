import {
	ApiError,
	requestHealthDiseasesBySymptoms,
} from "../../services/api-client";
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
};

function searchErrorMessage(error: unknown): string {
	if (error instanceof ApiError && error.code === "dependency-not-configured") {
		return "健康百科内容尚未发布，请稍后再试";
	}
	return "查找结果暂时无法加载，请稍后重试";
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
		const ids = (options.ids ?? "")
			.split(",")
			.map((id) => decodeURIComponent(id))
			.filter(Boolean);
		if (ids.length === 0) {
			this.setData({ state: "error", errorMessage: "缺少症状查询条件" });
			return;
		}
		this.setData({ queryIds: ids });
		void this.load(ids);
	},

	async load(ids: string[]) {
		this.setData({ state: "loading", errorMessage: "" });
		try {
			const response = await requestHealthDiseasesBySymptoms(ids);
			this.setData({
				items: response.data.items,
				state: response.data.items.length > 0 ? "ready" : "empty",
				disclaimer: response.data.publication.disclaimer,
				publicationVersion: response.data.publication.contentVersion,
			});
		} catch (error) {
			this.setData({ state: "error", errorMessage: searchErrorMessage(error) });
		}
	},

	onDiseaseTap(event: WechatMiniprogram.TouchEvent) {
		const id = String(event.currentTarget.dataset.id ?? "");
		if (!id) return;
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
});
