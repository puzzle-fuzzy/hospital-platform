import { type FeatureKey, navigateToFeatureStatus } from "./feature-navigation";
import {
	getFeatureMigrationCoverage,
	type MigrationCoverage,
} from "./migration-coverage";
import { USER_FACING_SURFACE_COPY } from "./user-facing-surface-copy";

export type PatientContractSurfaceFeature =
	| "patient-binding"
	| "patient-signature";

type PatientContractSurfaceDefinition = {
	scopeTitle: string;
	scopeDescription: string;
	boundaryItems: ReadonlyArray<string>;
	contractItems: ReadonlyArray<string>;
	showPatientSelector: boolean;
};

/**
 * 患者域的两个页面先统一迁移“入口 + 关闭态”，不共享患者写入模型。
 *
 * 旧端的新增绑定、患者签名和快递页面都存在未确认的 provider 或外部
 * 合同：绑定页不能在查档失败后继续建档，签名页不能复用假患者和硬编码
 * 外部小程序，快递页也不能把预留空数组当作真实查询结果。因此这里仅
 * 固定用户能看懂的范围、禁止事项和后续材料，等正式 contract 到达后再
 * 在各自页面接入 owner 校验、请求状态机和低敏日志。
 */
const PATIENT_CONTRACT_SURFACE_DEFINITIONS: Readonly<
	Record<PatientContractSurfaceFeature, PatientContractSurfaceDefinition>
> = Object.freeze({
	"patient-binding": {
		scopeTitle: "实名绑定范围",
		scopeDescription:
			"绑定关系必须由当前账号和医院服务端共同确认，不会只凭姓名或客户端患者号完成绑定。",
		boundaryItems: [
			"查档失败不能继续建档或绑卡",
			"姓名、身份证和手机号只用于受控的实名校验",
			"写入后必须重新查询最终患者关系和状态",
		],
		contractItems: [
			"实名同意、查档、建档和绑卡的顺序",
			"幂等键、重复绑定、撤回和失败补偿规则",
			"患者 owner、字段白名单和医护侧审计",
		],
		showPatientSelector: false,
	},
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
 * 注册患者域页面外壳。页面只做静态边界展示和安全导航，不读取患者缓存，
 * 不调用 provider，也不把“已进入页面”记录成真实业务成功。
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
