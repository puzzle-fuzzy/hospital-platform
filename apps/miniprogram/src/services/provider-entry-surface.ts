import { type FeatureKey, navigateToFeatureStatus } from "./feature-navigation";
import {
	getFeatureMigrationCoverage,
	type MigrationCoverage,
} from "./migration-coverage";
import {
	disposePatientSurfaceContext,
	INITIAL_PATIENT_SURFACE_CONTEXT,
	loadPatientSurfaceContext,
	type PatientSurfaceContextData,
} from "./patient-surface-context";

export type ProviderEntrySurfaceFeature =
	| "blood-appointment"
	| "appointment-detail";

type ProviderEntrySurfaceDefinition = {
	scopeTitle: string;
	scopeDescription: string;
	boundaryItems: ReadonlyArray<string>;
	contractItems: ReadonlyArray<string>;
};

/**
 * Provider 只读入口先统一到原生壳，保留患者选择但不发起 Provider 请求。
 * 预约详情和采血号源都不能用旧卡片索引、第一位患者或空列表冒充真实结果。
 */
const PROVIDER_ENTRY_SURFACE_DEFINITIONS: Readonly<
	Record<ProviderEntrySurfaceFeature, ProviderEntrySurfaceDefinition>
> = Object.freeze({
	"blood-appointment": {
		scopeTitle: "采血预约查询范围",
		scopeDescription:
			"采血预约需要独立的号源来源和患者映射，当前不读取普通门诊号源，也不提交预约。",
		boundaryItems: [
			"号源状态、时间和院区必须来自同一 Provider 版本",
			"患者归属要在服务端完成校验",
			"空号源、拒绝、超时和契约异常必须分开",
		],
		contractItems: [
			"采血号源请求与响应脱敏样例",
			"患者映射、状态枚举和字段白名单",
			"预约写入、取消和最终状态查询规则",
		],
	},
	"appointment-detail": {
		scopeTitle: "挂号详情查询范围",
		scopeDescription:
			"挂号详情必须使用服务端签发的预约引用和当前患者范围，当前不展示未经校验的卡片明细。",
		boundaryItems: [
			"不能使用列表索引或客户端拼接 Provider 编号",
			"预约状态必须按固定枚举映射",
			"原始挂号号、身份证和内部标识不直接返回",
		],
		contractItems: [
			"预约引用、患者 owner 和状态样例",
			"展示字段、脱敏字段和过期规则",
			"空、拒绝、超时和 Provider 异常语义",
		],
	},
});

export type ProviderEntrySurfacePageData = PatientSurfaceContextData & {
	title: string;
	icon: string;
	surfaceLabel: string;
	description: string;
	scopeTitle: string;
	scopeDescription: string;
	boundaryItems: ReadonlyArray<string>;
	contractItems: ReadonlyArray<string>;
	coverageLabel: string;
};

function toPageData(
	feature: ProviderEntrySurfaceFeature,
	coverage: MigrationCoverage,
): ProviderEntrySurfacePageData {
	const definition = PROVIDER_ENTRY_SURFACE_DEFINITIONS[feature];
	return {
		...INITIAL_PATIENT_SURFACE_CONTEXT,
		title: coverage.feature.title,
		icon: coverage.feature.icon,
		surfaceLabel: "原生入口已迁移 · Provider 读取仍关闭",
		description:
			"当前页面只展示查询范围和开放条件，不会调用号源、读取详情、提交预约或把空数据渲染成成功。",
		scopeTitle: definition.scopeTitle,
		scopeDescription: definition.scopeDescription,
		boundaryItems: definition.boundaryItems,
		contractItems: definition.contractItems,
		coverageLabel: coverage.coverageLabel,
	};
}

/** 注册预约类 Provider 入口关闭态；真实读取必须先完成引用、owner 和字段白名单契约。 */
export function registerProviderEntrySurfacePage(
	feature: ProviderEntrySurfaceFeature,
): void {
	const initialCoverage = getFeatureMigrationCoverage(feature);
	Page<ProviderEntrySurfacePageData, ProviderEntrySurfacePageMethods>({
		data: toPageData(feature, initialCoverage),
		onLoad() {
			const coverage = getFeatureMigrationCoverage(feature);
			this.setData(toPageData(feature, coverage));
			wx.setNavigationBarTitle({ title: coverage.feature.title });
			void this.loadPatientContext();
		},
		onShow() {
			if (this.data.patientContextLoaded) void this.loadPatientContext();
		},
		loadPatientContext() {
			return loadPatientSurfaceContext(this, `provider-surface-${feature}`);
		},
		onOpenPatientSelector() {
			wx.navigateTo({ url: "/pages/patient-select/patient-select" });
		},
		onOpenMigrationStatus() {
			navigateToFeatureStatus(feature as FeatureKey);
		},
		onBackHome() {
			wx.switchTab({ url: "/pages/index/index" });
		},
		onRetry() {
			if (!this.data.patientContextLoading) void this.loadPatientContext();
		},
		onUnload() {
			disposePatientSurfaceContext(this);
		},
	});
}

type ProviderEntrySurfacePageMethods = {
	loadPatientContext(): Promise<void>;
	onOpenPatientSelector(): void;
	onOpenMigrationStatus(): void;
	onBackHome(): void;
	onRetry(): void;
	onUnload(): void;
};
