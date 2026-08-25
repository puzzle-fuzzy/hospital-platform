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
};

type SearchPageMethods = {
	load(ids: string[]): Promise<void>;
	onDiseaseTap(event: WechatMiniprogram.TouchEvent): void;
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
});
