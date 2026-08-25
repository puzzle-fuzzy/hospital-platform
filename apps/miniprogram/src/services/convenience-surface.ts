import type { Patient } from "../types";
import { ApiError } from "./api-client";
import { loadCurrentPatient } from "./dashboard-service";
import { type FeatureKey, navigateToFeatureStatus } from "./feature-navigation";
import { getFeatureMigrationCoverage } from "./migration-coverage";
import {
	disposePageInstance,
	getPageLatestRequestGuard,
} from "./page-instance-state";

export type ConvenienceSurfaceFeature = "gift-banner" | "health-praise";

type ConvenienceSurfaceDefinition = {
	title: string;
	recordTitle: string;
	recordNote: string;
	contractItems: ReadonlyArray<string>;
};

const DEFINITIONS: Readonly<
	Record<ConvenienceSurfaceFeature, ConvenienceSurfaceDefinition>
> = Object.freeze({
	"gift-banner": {
		title: "电子锦旗",
		recordTitle: "电子锦旗记录",
		recordNote:
			"公开记录查询和赠送功能等待独立服务契约，当前不读取、不提交任何内容。",
		contractItems: [
			"患者、医生和就诊引用的服务端归属规则",
			"文字/图片审核、内容安全和公开展示脱敏规则",
			"赠送、撤回、分页和管理端读取的状态机",
		],
	},
	"health-praise": {
		title: "表扬信",
		recordTitle: "表扬信记录",
		recordNote:
			"公开记录查询和写入功能等待独立服务契约，当前不读取、不提交任何内容。",
		contractItems: [
			"就诊、患者和医生关系的服务端引用规则",
			"内容审核、敏感信息脱敏和公开展示权限",
			"提交幂等、撤回、分页和管理端读取状态",
		],
	},
});

type ConvenienceSurfacePageData = {
	title: string;
	patient: Patient | null;
	loading: boolean;
	error: string;
	recordTitle: string;
	recordNote: string;
	contractItems: ReadonlyArray<string>;
	coverageLabel: string;
};

type ConvenienceSurfacePageMethods = {
	loadCurrentPatient(): Promise<void>;
	onOpenPatientSelector(): void;
	onOpenMigrationStatus(): void;
	onRetry(): void;
	onBackHome(): void;
	onUnload(): void;
};

function getErrorMessage(error: unknown): string {
	if (error instanceof ApiError && error.code === "unauthorized") {
		return "登录状态已失效，请返回首页重新登录";
	}
	if (error instanceof ApiError && error.code === "dependency-not-configured") {
		return "就诊人服务暂不可用，请稍后重试";
	}
	return "就诊人信息暂时无法加载，请重试";
}

function toPageData(
	feature: ConvenienceSurfaceFeature,
): ConvenienceSurfacePageData {
	const definition = DEFINITIONS[feature];
	return {
		title: definition.title,
		patient: null,
		loading: true,
		error: "",
		recordTitle: definition.recordTitle,
		recordNote: definition.recordNote,
		contractItems: definition.contractItems,
		coverageLabel: getFeatureMigrationCoverage(feature).coverageLabel,
	};
}

/**
 * 电子锦旗和表扬信共用页面结构，但不共用未来的内容 Provider 模型。
 *
 * 旧端同时存在列表、记录和提交页面，并且会把患者/医生快照直接交给
 * 外部接口。这里先迁移真实可确认的页面结构与当前就诊人选择，记录区域
 * 明确显示“服务待接入”，避免把未查询当成空记录，也避免产生写入副作用。
 */
export function registerConvenienceSurfacePage(
	feature: ConvenienceSurfaceFeature,
): void {
	Page<ConvenienceSurfacePageData, ConvenienceSurfacePageMethods>({
		data: toPageData(feature),

		onLoad() {
			this.setData(toPageData(feature));
			wx.setNavigationBarTitle({ title: DEFINITIONS[feature].title });
			void this.loadCurrentPatient();
		},

		onShow() {
			// 从患者选择页返回后重新读取当前患者，避免记录页保留旧上下文。
			if (!this.data.loading) void this.loadCurrentPatient();
		},

		loadCurrentPatient() {
			const guard = getPageLatestRequestGuard(this, `convenience-${feature}`);
			const token = guard.begin();
			this.setData({ loading: true, error: "" });
			return loadCurrentPatient()
				.then((patient) => {
					if (guard.isCurrent(token)) this.setData({ patient });
				})
				.catch((error) => {
					if (guard.isCurrent(token)) {
						this.setData({ patient: null, error: getErrorMessage(error) });
					}
				})
				.finally(() => {
					if (guard.isCurrent(token)) this.setData({ loading: false });
				});
		},

		onOpenPatientSelector() {
			wx.navigateTo({ url: "/pages/patient-select/patient-select" });
		},

		onOpenMigrationStatus() {
			navigateToFeatureStatus(feature as FeatureKey);
		},

		onRetry() {
			if (!this.data.loading) void this.loadCurrentPatient();
		},

		onBackHome() {
			wx.switchTab({ url: "/pages/index/index" });
		},

		onUnload() {
			disposePageInstance(this);
		},
	});
}
