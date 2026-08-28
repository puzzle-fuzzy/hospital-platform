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
import { USER_FACING_SURFACE_COPY } from "./user-facing-surface-copy";

export type ExternalEntrySurfaceFeature =
	| "smart-customer"
	| "consultation"
	| "patient-subscription";

type ExternalEntrySurfaceDefinition = {
	showPatientSelector: boolean;
	scopeTitle: string;
	scopeDescription: string;
	boundaryItems: ReadonlyArray<string>;
	contractItems: ReadonlyArray<string>;
};

/**
 * 外部入口只先迁移可解释的原生壳。此处禁止拼接旧 WebView URL、复用平台
 * token 或把本地开关当作微信授权成功，避免“页面看起来完成”却绕过域名、
 * 受众和短期会话安全边界。
 */
const EXTERNAL_ENTRY_SURFACE_DEFINITIONS: Readonly<
	Record<ExternalEntrySurfaceFeature, ExternalEntrySurfaceDefinition>
> = Object.freeze({
	"smart-customer": {
		showPatientSelector: false,
		scopeTitle: "智能客服入口范围",
		scopeDescription:
			"智能客服可能承载外部会话或 WebView，当前只展示迁移状态，不会打开旧域名或转交登录态。",
		boundaryItems: [
			"外部域名必须使用固定 HTTPS allowlist",
			"平台 token 不直接进入外部页面",
			"会话必须有受众、短期有效期和明确退出",
		],
		contractItems: [
			"域名、回跳和错误页配置",
			"短期 ticket、受众和会话撤销",
			"客服内容的日志、隐私和留存规则",
		],
	},
	consultation: {
		showPatientSelector: true,
		scopeTitle: "问诊记录入口范围",
		scopeDescription:
			"问诊记录涉及外部会话和患者归属，当前不会把问诊会话当成普通就诊人列表。",
		boundaryItems: [
			"会话索引必须按 owner 和患者范围过滤",
			"正文、附件和医生信息分别按白名单展示",
			"外部入口退出后不能继续复用旧 ticket",
		],
		contractItems: [
			"问诊会话来源、状态和保留周期",
			"患者归属、脱敏字段和短期引用",
			"allowlist、回跳、撤销和审计规则",
		],
	},
	"patient-subscription": {
		showPatientSelector: false,
		scopeTitle: "微信消息订阅范围",
		scopeDescription:
			"本地勾选只能表达页面意图，不能代表微信订阅授权或消息发送成功，当前不修改授权状态。",
		boundaryItems: [
			"模板 ID、授权时机和业务事件必须对应",
			"用户拒绝、过期和撤销不能显示为已订阅",
			"发送结果必须由服务端回执确认",
		],
		contractItems: [
			"订阅模板、事件和授权回执",
			"发送失败、重试和幂等语义",
			"撤销、隐私告知和审计日志",
		],
	},
});

export type ExternalEntrySurfacePageData = PatientSurfaceContextData & {
	title: string;
	icon: string;
	showPatientSelector: boolean;
	surfaceLabel: string;
	description: string;
	scopeTitle: string;
	scopeDescription: string;
	boundaryItems: ReadonlyArray<string>;
	contractItems: ReadonlyArray<string>;
	coverageLabel: string;
};

function toPageData(
	feature: ExternalEntrySurfaceFeature,
	coverage: MigrationCoverage,
): ExternalEntrySurfacePageData {
	const definition = EXTERNAL_ENTRY_SURFACE_DEFINITIONS[feature];
	return {
		...INITIAL_PATIENT_SURFACE_CONTEXT,
		title: coverage.feature.title,
		icon: coverage.feature.icon,
		showPatientSelector: definition.showPatientSelector,
		...USER_FACING_SURFACE_COPY,
	};
}

/** 注册外部入口关闭态，待 allowlist、受众、短期会话和回跳 contract 冻结后再接真实跳转。 */
export function registerExternalEntrySurfacePage(
	feature: ExternalEntrySurfaceFeature,
): void {
	const initialCoverage = getFeatureMigrationCoverage(feature);
	Page<ExternalEntrySurfacePageData, ExternalEntrySurfacePageMethods>({
		data: toPageData(feature, initialCoverage),
		onLoad() {
			const coverage = getFeatureMigrationCoverage(feature);
			this.setData(toPageData(feature, coverage));
			wx.setNavigationBarTitle({ title: coverage.feature.title });
			if (feature === "consultation") void this.loadPatientContext();
		},
		onShow() {
			if (this.data.patientContextLoaded) void this.loadPatientContext();
		},
		loadPatientContext() {
			return loadPatientSurfaceContext(this, `external-surface-${feature}`);
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

type ExternalEntrySurfacePageMethods = {
	loadPatientContext(): Promise<void>;
	onOpenPatientSelector(): void;
	onOpenMigrationStatus(): void;
	onBackHome(): void;
	onRetry(): void;
	onUnload(): void;
};
