import {
	ApiError,
	requestHealthDiseaseDetail,
	requestHealthDrugDetail,
} from "../../services/api-client";
import type {
	HealthKnowledgeDiseaseDetail,
	HealthKnowledgeDrugDetail,
} from "../../types";

type DetailKind = "disease" | "drug";
type DetailState = "loading" | "ready" | "error";
type DetailPageData = {
	kind: DetailKind;
	state: DetailState;
	errorMessage: string;
	disclaimer: string;
	publicationVersion: string;
	disease: HealthKnowledgeDiseaseDetail | null;
	drug: HealthKnowledgeDrugDetail | null;
};

type DetailPageMethods = {
	load(kind: DetailKind, id: string): Promise<void>;
	onDrugTap(event: WechatMiniprogram.TouchEvent): void;
};

function detailErrorMessage(error: unknown): string {
	if (error instanceof ApiError && error.code === "not-found") {
		return "该条内容暂不可用";
	}
	if (error instanceof ApiError && error.code === "dependency-not-configured") {
		return "健康百科内容尚未发布，请稍后再试";
	}
	return "详情暂时无法加载，请稍后重试";
}

Page<DetailPageData, DetailPageMethods>({
	data: {
		kind: "disease",
		state: "loading",
		errorMessage: "",
		disclaimer: "",
		publicationVersion: "",
		disease: null,
		drug: null,
	},

	onLoad(options: Record<string, string | undefined>) {
		const kind: DetailKind = options.kind === "drug" ? "drug" : "disease";
		const id = options.id ?? "";
		if (!id) {
			this.setData({ state: "error", errorMessage: "缺少内容标识" });
			return;
		}
		this.setData({ kind });
		void this.load(kind, id);
	},

	async load(kind: DetailKind, id: string) {
		this.setData({ state: "loading", errorMessage: "" });
		try {
			if (kind === "drug") {
				const response = await requestHealthDrugDetail(id);
				this.setData({
					state: "ready",
					drug: response.data.item,
					publicationVersion: response.data.publication.contentVersion,
					disclaimer: response.data.publication.disclaimer,
				});
				wx.setNavigationBarTitle({ title: response.data.item.drugName });
				return;
			}

			const response = await requestHealthDiseaseDetail(id);
			this.setData({
				state: "ready",
				disease: response.data.item,
				publicationVersion: response.data.publication.contentVersion,
				disclaimer: response.data.publication.disclaimer,
			});
			wx.setNavigationBarTitle({ title: response.data.item.diseaseName });
		} catch (error) {
			this.setData({ state: "error", errorMessage: detailErrorMessage(error) });
		}
	},

	onDrugTap(event: WechatMiniprogram.TouchEvent) {
		const id = String(event.currentTarget.dataset.id ?? "");
		if (!id) return;
		wx.navigateTo({
			url: `/pages/health-knowledge-detail/health-knowledge-detail?kind=drug&id=${encodeURIComponent(id)}`,
		});
	},
});
