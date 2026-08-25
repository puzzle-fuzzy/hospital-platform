import {
	ApiError,
	requestHealthDiseasesByRelation,
	requestHealthKnowledgeCatalog,
	requestHealthSymptomsByPart,
} from "../../services/api-client";
import {
	resolveKnowledgePanelState,
	resolveKnowledgeTabSource,
} from "../../services/health-knowledge-view";
import type {
	HealthKnowledgeCatalogItem,
	HealthKnowledgeDiseaseSummary,
	HealthKnowledgeSymptomItem,
} from "../../types";

type KnowledgeTab = "symptom" | "disease";
type DiseaseMode = "part" | "crowd" | "department";
type PageState = "idle" | "loading" | "ready" | "empty" | "error";
type LeftItem = HealthKnowledgeCatalogItem;

type KnowledgePageMethods = {
	requestSerial: number;
	loadParts(): Promise<void>;
	loadSymptoms(partId: string, serial?: number): Promise<void>;
	loadDiseaseCatalog(mode: DiseaseMode): Promise<void>;
	loadDiseases(mode: DiseaseMode, id: string, serial?: number): Promise<void>;
	onTabChange(event: WechatMiniprogram.TouchEvent): void;
	onDiseaseModeChange(event: WechatMiniprogram.TouchEvent): void;
	onLeftItemTap(event: WechatMiniprogram.TouchEvent): void;
	onSymptomTap(event: WechatMiniprogram.TouchEvent): void;
	onRemoveSymptom(event: WechatMiniprogram.TouchEvent): void;
	onSearchSymptoms(): void;
	onDiseaseTap(event: WechatMiniprogram.TouchEvent): void;
	onRetry(): void;
};

type KnowledgePageData = {
	activeTab: KnowledgeTab;
	diseaseMode: DiseaseMode;
	parts: LeftItem[];
	crowds: LeftItem[];
	departments: LeftItem[];
	leftItems: LeftItem[];
	rightItems: Array<HealthKnowledgeSymptomItem | HealthKnowledgeDiseaseSummary>;
	selectedSymptoms: HealthKnowledgeSymptomItem[];
	selectedSymptomIds: string[];
	selectedLeftId: string;
	state: PageState;
	errorMessage: string;
	publicationVersion: string;
	disclaimer: string;
};

const EMPTY_DATA: KnowledgePageData = {
	activeTab: "symptom",
	diseaseMode: "part",
	parts: [],
	crowds: [],
	departments: [],
	leftItems: [],
	rightItems: [],
	selectedSymptoms: [],
	selectedSymptomIds: [],
	selectedLeftId: "",
	state: "idle",
	errorMessage: "",
	publicationVersion: "",
	disclaimer: "",
};

/**
 * 页面只展示服务端审核后的版本信息；错误不能折叠成“暂无数据”，否则
 * 内容未发布、网络异常和真实空目录会被用户误认为同一件事。
 */
function errorMessage(error: unknown): string {
	if (error instanceof ApiError) {
		if (error.code === "dependency-not-configured") {
			return "健康百科内容尚未发布，请稍后再试";
		}
		if (error.code === "persistence-temporarily-unavailable") {
			return "数据服务暂时不可用，请稍后重试";
		}
	}
	return "健康百科暂时无法加载，请稍后重试";
}

Page<KnowledgePageData, KnowledgePageMethods>({
	data: EMPTY_DATA,
	requestSerial: 0,

	onLoad() {
		void this.loadParts();
	},

	onPullDownRefresh() {
		void this.loadParts().finally(() => wx.stopPullDownRefresh());
	},

	async loadParts() {
		const serial = ++this.requestSerial;
		this.setData({ state: "loading", errorMessage: "" });
		try {
			const response = await requestHealthKnowledgeCatalog("part");
			if (serial !== this.requestSerial) return;
			const parts = response.data.items;
			this.setData({
				parts,
				leftItems: parts,
				selectedLeftId: parts[0]?.id ?? "",
				publicationVersion: response.data.publication.contentVersion,
				disclaimer: response.data.publication.disclaimer,
			});
			if (parts.length === 0) {
				this.setData({ state: "empty" });
				return;
			}
			await this.loadSymptoms(parts[0]?.id ?? "", serial);
		} catch (error) {
			if (serial !== this.requestSerial) return;
			this.setData({ state: "error", errorMessage: errorMessage(error) });
		}
	},

	async loadSymptoms(partId: string, serial?: number) {
		const requestSerial = serial ?? ++this.requestSerial;
		if (!partId) {
			this.setData({ state: "empty", rightItems: [] });
			return;
		}
		this.setData({ state: "loading", errorMessage: "" });
		try {
			const response = await requestHealthSymptomsByPart(partId);
			if (requestSerial !== this.requestSerial) return;
			this.setData({
				rightItems: response.data.items,
				// 左侧目录仍然存在时，右侧空结果必须保持 ready；否则
				// 页面级 empty 会把左侧分类一起隐藏，用户无法继续切换。
				state: resolveKnowledgePanelState(this.data.leftItems.length),
				publicationVersion: response.data.publication.contentVersion,
				disclaimer: response.data.publication.disclaimer,
			});
		} catch (error) {
			if (requestSerial !== this.requestSerial) return;
			this.setData({ state: "error", errorMessage: errorMessage(error) });
		}
	},

	async loadDiseaseCatalog(mode: DiseaseMode) {
		const serial = ++this.requestSerial;
		this.setData({ state: "loading", errorMessage: "" });
		try {
			const response = await requestHealthKnowledgeCatalog(mode);
			if (serial !== this.requestSerial) return;
			const items = response.data.items;
			this.setData({
				...(mode === "part" ? { parts: items } : {}),
				...(mode === "crowd" ? { crowds: items } : {}),
				...(mode === "department" ? { departments: items } : {}),
				leftItems: items,
				selectedLeftId: items[0]?.id ?? "",
				publicationVersion: response.data.publication.contentVersion,
				disclaimer: response.data.publication.disclaimer,
			});
			if (items.length === 0) {
				this.setData({ state: "empty", rightItems: [] });
				return;
			}
			await this.loadDiseases(mode, items[0]?.id ?? "", serial);
		} catch (error) {
			if (serial !== this.requestSerial) return;
			this.setData({ state: "error", errorMessage: errorMessage(error) });
		}
	},

	async loadDiseases(mode: DiseaseMode, id: string, serial?: number) {
		const requestSerial = serial ?? ++this.requestSerial;
		if (!id) {
			this.setData({ state: "empty", rightItems: [] });
			return;
		}
		this.setData({ state: "loading", errorMessage: "" });
		try {
			const response = await requestHealthDiseasesByRelation(mode, id);
			if (requestSerial !== this.requestSerial) return;
			this.setData({
				rightItems: response.data.items,
				// 分类目录有内容但当前关系为空属于右栏空态，不能升级为
				// 整页空态；WXML 会继续显示左栏和“暂无该分类内容”。
				state: resolveKnowledgePanelState(this.data.leftItems.length),
				publicationVersion: response.data.publication.contentVersion,
				disclaimer: response.data.publication.disclaimer,
			});
		} catch (error) {
			if (requestSerial !== this.requestSerial) return;
			this.setData({ state: "error", errorMessage: errorMessage(error) });
		}
	},

	onTabChange(event: WechatMiniprogram.TouchEvent) {
		const tab = event.currentTarget.dataset.tab as KnowledgeTab;
		if (tab === this.data.activeTab) return;
		this.setData({ activeTab: tab, rightItems: [], state: "loading" });
		const source = resolveKnowledgeTabSource(tab, this.data.parts.length);
		if (source === "reload-symptom-catalog") {
			// 没有已确认的部位目录时，必须重新读取目录；不能把空数组
			// 当成有效的 partId 传给关联查询，否则会把加载失败伪装成空态。
			void this.loadParts();
			return;
		}
		if (source === "reload-disease-catalog") {
			// 疾病 Tab 的默认“按部位”关系需要独立取得目录。旧的
			// symptom 请求失败不应让疾病 Tab 直接落入“暂无内容”。
			void this.loadDiseaseCatalog("part");
			return;
		}
		if (tab === "symptom") {
			const partId = this.data.parts[0]?.id ?? "";
			this.setData({
				leftItems: this.data.parts,
				diseaseMode: "part",
				selectedLeftId: partId,
			});
			void this.loadSymptoms(partId);
			return;
		}
		this.setData({ leftItems: this.data.parts, diseaseMode: "part" });
		void this.loadDiseases("part", this.data.parts[0]?.id ?? "");
	},

	onDiseaseModeChange(event: WechatMiniprogram.TouchEvent) {
		const mode = event.currentTarget.dataset.mode as DiseaseMode;
		if (mode === this.data.diseaseMode && this.data.activeTab === "disease") {
			return;
		}
		this.setData({ activeTab: "disease", diseaseMode: mode });
		const cached =
			mode === "part"
				? this.data.parts
				: mode === "crowd"
					? this.data.crowds
					: this.data.departments;
		if (cached.length > 0) {
			this.setData({ leftItems: cached, selectedLeftId: cached[0]?.id ?? "" });
			void this.loadDiseases(mode, cached[0]?.id ?? "");
			return;
		}
		void this.loadDiseaseCatalog(mode);
	},

	onLeftItemTap(event: WechatMiniprogram.TouchEvent) {
		const id = String(event.currentTarget.dataset.id ?? "");
		this.setData({ selectedLeftId: id });
		if (this.data.activeTab === "symptom") {
			void this.loadSymptoms(id);
		} else {
			void this.loadDiseases(this.data.diseaseMode, id);
		}
	},

	onSymptomTap(event: WechatMiniprogram.TouchEvent) {
		const id = String(event.currentTarget.dataset.id ?? "");
		const item = this.data.rightItems.find((candidate) => candidate.id === id);
		if (!item || !("initialLetter" in item)) return;
		const selected = this.data.selectedSymptoms.some(
			(candidate) => candidate.id === id,
		)
			? this.data.selectedSymptoms.filter((candidate) => candidate.id !== id)
			: [...this.data.selectedSymptoms, item];
		this.setData({
			selectedSymptoms: selected,
			selectedSymptomIds: selected.map((candidate) => candidate.id),
		});
	},

	onRemoveSymptom(event: WechatMiniprogram.TouchEvent) {
		const id = String(event.currentTarget.dataset.id ?? "");
		this.setData({
			selectedSymptoms: this.data.selectedSymptoms.filter(
				(item) => item.id !== id,
			),
			selectedSymptomIds: this.data.selectedSymptomIds.filter(
				(itemId) => itemId !== id,
			),
		});
	},

	onSearchSymptoms() {
		if (this.data.selectedSymptoms.length === 0) {
			wx.showToast({ title: "请先选择症状", icon: "none" });
			return;
		}
		const ids = this.data.selectedSymptoms
			.map((item) => item.id)
			.map(encodeURIComponent)
			.join(",");
		wx.navigateTo({
			url: `/pages/health-knowledge-search/health-knowledge-search?ids=${ids}`,
		});
	},

	onDiseaseTap(event: WechatMiniprogram.TouchEvent) {
		const id = String(event.currentTarget.dataset.id ?? "");
		if (!id) return;
		wx.navigateTo({
			url: `/pages/health-knowledge-detail/health-knowledge-detail?kind=disease&id=${encodeURIComponent(id)}`,
		});
	},

	onRetry() {
		if (this.data.activeTab === "symptom") void this.loadParts();
		else void this.loadDiseaseCatalog(this.data.diseaseMode);
	},
});
