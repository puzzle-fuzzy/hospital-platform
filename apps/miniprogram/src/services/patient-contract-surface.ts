import { type FeatureKey, navigateToFeatureStatus } from "./feature-navigation";
import {
	getFeatureMigrationCoverage,
	type MigrationCoverage,
} from "./migration-coverage";
import { USER_FACING_SURFACE_COPY } from "./user-facing-surface-copy";

export type PatientContractSurfaceFeature = "patient-signature";

type PatientContractSurfaceDefinition = {
	scopeTitle: string;
	scopeDescription: string;
	boundaryItems: ReadonlyArray<string>;
	contractItems: ReadonlyArray<string>;
	showPatientSelector: boolean;
};

/**
 * 患者签名等仍待正式 contract 的页面统一使用“入口 + 关闭态”，不共享患者写入模型。
 *
 * 签名页面不能复用假患者和硬编码外部小程序。因此这里仅固定用户能看懂
 * 的范围、禁止事项和后续材料，等正式 contract 到达后再接入 owner 校验、
 * 请求状态机和低敏日志。新增就诊人页面已经改为独立的真实姓名资料表单，
 * 不再使用本关闭态工厂。
 */
const PATIENT_CONTRACT_SURFACE_DEFINITIONS: Readonly<
	Record<PatientContractSurfaceFeature, PatientContractSurfaceDefinition>
> = Object.freeze({
	"patient-signature": {
		scopeTitle: "患者签名范围",
		scopeDescription:
			"签名必须绑定明确用途和当前就诊人，不会复用旧端假患者列表或未知外部小程序参数。",
		boundaryItems: [
			"签名前必须明确业务用途和受众",
			"文件上传、访问和撤回都要经过服务端授权",
			"签名文件不能跨账号或跨就诊人读取",
		],
		contractItems: [
			"签名用途、授权文案和撤回语义",
			"文件类型、大小、病毒扫描和短期访问策略",
			"医护侧读取范围、审计字段和失败回退",
		],
		showPatientSelector: true,
	},
});

export type PatientContractSurfacePageData = {
	title: string;
	icon: string;
	readiness: string;
	surfaceLabel: string;
	description: string;
	scopeTitle: string;
	scopeDescription: string;
	boundaryItems: ReadonlyArray<string>;
	contractItems: ReadonlyArray<string>;
	coverageLabel: string;
	showPatientSelector: boolean;
};

function toPageData(
	feature: PatientContractSurfaceFeature,
	coverage: MigrationCoverage,
): PatientContractSurfacePageData {
	const definition = PATIENT_CONTRACT_SURFACE_DEFINITIONS[feature];
	return {
		title: coverage.feature.title,
		icon: coverage.feature.icon,
		readiness: coverage.feature.readiness,
		...USER_FACING_SURFACE_COPY,
		scopeTitle: definition.scopeTitle,
		scopeDescription: definition.scopeDescription,
		boundaryItems: definition.boundaryItems,
		contractItems: definition.contractItems,
		showPatientSelector: definition.showPatientSelector,
	};
}

/**
 * 注册仍待正式 contract 的患者域页面外壳。页面只做静态边界展示和安全
 * 导航，不读取患者缓存，不调用 provider，也不把“已进入页面”记录成真实
 * 业务成功。
 */
export function registerPatientContractSurfacePage(
	feature: PatientContractSurfaceFeature,
): void {
	const initialCoverage = getFeatureMigrationCoverage(feature);
	Page<PatientContractSurfacePageData, PatientContractSurfacePageMethods>({
		data: toPageData(feature, initialCoverage),
		onLoad() {
			const coverage = getFeatureMigrationCoverage(feature);
			this.setData(toPageData(feature, coverage));
			wx.setNavigationBarTitle({ title: coverage.feature.title });
		},
		onOpenPatientSelector() {
			wx.navigateTo({ url: "/pages/patient-select/patient-select" });
		},
		onBackPatientSelector() {
			wx.navigateBack({ delta: 1 });
		},
		onOpenMigrationStatus() {
			navigateToFeatureStatus(feature as FeatureKey);
		},
		onOpenPatientAgreement() {
			// 只能打开静态协议原文；协议同意、撤回和审计仍等待独立 contract。
			wx.navigateTo({ url: "/pages/patient-agreement/patient-agreement" });
		},
		onBackMy() {
			wx.switchTab({ url: "/pages/my/my" });
		},
	});
}

type PatientContractSurfacePageMethods = {
	onOpenPatientSelector(): void;
	onBackPatientSelector(): void;
	onOpenMigrationStatus(): void;
	onOpenPatientAgreement(): void;
	onBackMy(): void;
};
