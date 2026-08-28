import {
	ApiError,
	requestHealthDiseaseDetail,
	requestHealthDrugDetail,
} from "../../services/api-client";
import {
	disposePageInstance,
	getPageLatestRequestGuard,
} from "../../services/page-instance-state";
import type {
	HealthKnowledgeDiseaseDetail,
	HealthKnowledgeDrugDetail,
} from "../../types";

type DetailKind = "disease" | "drug";
type DetailState = "loading" | "ready" | "error";
type DetailPageData = {
	kind: DetailKind;
	/** 错误态重试需要保留服务端 opaque 内容 ID，不能重新读取任意外部参数。 */
	contentId: string;
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
	onRetry(): void;
	onUnload(): void;
};

function detailErrorMessage(error: unknown): string {
	if (error instanceof ApiError && error.code === "not-found") {
		return "未找到相关健康内容";
	}
	if (error instanceof ApiError && error.code === "dependency-not-configured") {
		return "健康内容正在完善中，暂时无法使用";
	}
	return "健康内容暂时无法获取，请稍后再试";
}

Page<DetailPageData, DetailPageMethods>({
	data: {
		kind: "disease",
		contentId: "",
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
		this.setData({ kind, contentId: id });
		void this.load(kind, id);
	},

	async load(kind: DetailKind, id: string) {
		const guard = getPageLatestRequestGuard(this, "health-knowledge-detail");
		const token = guard.begin();
		// 详情请求切换期间不保留旧正文，避免页面状态虽然是 loading，
		// 但后续重试或页面复用仍能读到上一条疾病/药品内容。
		this.setData({
			kind,
			contentId: id,
			state: "loading",
			errorMessage: "",
			disclaimer: "",
			publicationVersion: "",
			disease: null,
			drug: null,
		});
		try {
			if (kind === "drug") {
				const response = await requestHealthDrugDetail(id);
				if (!guard.isCurrent(token)) return;
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
			if (!guard.isCurrent(token)) return;
			this.setData({
				state: "ready",
				disease: response.data.item,
				publicationVersion: response.data.publication.contentVersion,
				disclaimer: response.data.publication.disclaimer,
			});
			wx.setNavigationBarTitle({ title: response.data.item.diseaseName });
		} catch (error) {
			if (guard.isCurrent(token)) {
				this.setData({
					state: "error",
					errorMessage: detailErrorMessage(error),
				});
			}
		}
	},

	onDrugTap(event: WechatMiniprogram.TouchEvent) {
		const id = String(event.currentTarget.dataset.id ?? "");
		// 详情页中的药品引用必须来自当前已经确认的疾病读模型；不可点击的
		// 药品没有 drugId，旧事件也不能越过当前页面内容范围发起深链。
		if (
			!id ||
			this.data.kind !== "disease" ||
			!this.data.disease?.availableDrugs.some(
				(drug) => drug.drugId === id && drug.isClickable,
			)
		)
			return;
		wx.navigateTo({
			url: `/pages/health-knowledge-detail/health-knowledge-detail?kind=drug&id=${encodeURIComponent(id)}`,
		});
	},

	/** 详情失败时只重试当前已经通过页面入口校验的内容引用。 */
	onRetry() {
		if (this.data.state === "loading" || !this.data.contentId) return;
		void this.load(this.data.kind, this.data.contentId);
	},

	/** 页面卸载后让未完成的内容查询失去回写资格。 */
	onUnload() {
		disposePageInstance(this);
	},
});
