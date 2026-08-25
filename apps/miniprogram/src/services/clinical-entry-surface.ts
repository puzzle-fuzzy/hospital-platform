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

export type ClinicalSurfaceFeature =
	| "medical-record"
	| "inpatient-center"
	| "doctor"
	| "electronic-consultation";

type ClinicalSurfaceDefinition = {
	scopeTitle: string;
	scopeDescription: string;
	boundaryItems: ReadonlyArray<string>;
	contractItems: ReadonlyArray<string>;
};

/**
 * 四个临床页面先共享“页面外壳”而不共享临床数据模型。
 *
 * 这些文案只说明已经固定的迁移边界，不构造医生、住院、病历或导诊的
 * 假数据。正式 Provider contract 到达后，可以在各页面保留同一外壳，
 * 只替换对应域的数据状态机和字段白名单。
 */
const CLINICAL_SURFACE_DEFINITIONS: Readonly<
	Record<ClinicalSurfaceFeature, ClinicalSurfaceDefinition>
> = Object.freeze({
	"medical-record": {
		scopeTitle: "门诊病历查询范围",
		scopeDescription:
			"只读取当前账号明确选择的就诊人，不使用报告、预约或费用记录冒充病历。",
		boundaryItems: [
			"病历目录和病历正文分开授权",
			"Provider 患者号不直接进入小程序",
			"合法空结果与拒绝、超时状态分开",
		],
		contractItems: [
			"HIS/EMR out-visit-records 请求与响应样例",
			"目录字段、正文字段和禁止字段白名单",
			"owner/患者映射、短期引用和详情权限",
		],
	},
	"inpatient-center": {
		scopeTitle: "住院信息查询范围",
		scopeDescription:
			"住院 episode 是独立临床事实，不会由门诊 patientId 自动推导或静默选择第一条记录。",
		boundaryItems: [
			"多次住院必须有可解释的 episode 选择",
			"在院、出院和未知状态不能混为一谈",
			"住院费用与门诊费用保持独立模型",
		],
		contractItems: [
			"住院 episode 权威来源和患者标识映射",
			"状态枚举、时间范围和脱敏字段",
			"合法空、拒绝、超时和患者授权样例",
		],
	},
	doctor: {
		scopeTitle: "我的医生查询范围",
		scopeDescription:
			"医生目录事实与患者关系事实分开维护，不展示旧端缓存的医生快照。",
		boundaryItems: [
			"客户端不能提交医生姓名或 Provider 医生号建立关系",
			"医生下线或失效后不能继续展示旧关系快照",
			"医生联系方式和内部标识不进入患者端公共响应",
		],
		contractItems: [
			"受控医生目录来源、版本和更新时间",
			"患者关系 owner、失效和撤销语义",
			"头像、职称、科室和擅长字段展示白名单",
		],
	},
	"electronic-consultation": {
		scopeTitle: "电子导诊单查询范围",
		scopeDescription:
			"电子导诊单不等同于预约摘要、实时叫号或外部问诊会话，必须使用独立来源。",
		boundaryItems: [
			"不读取旧缓存或拼接任意 WebView 地址",
			"不把导诊结果解释成诊断或预约成功",
			"患者上下文和外部受众必须分别校验",
		],
		contractItems: [
			"导诊单专用来源、版本和请求响应样例",
			"患者上下文、读取权限和保留周期",
			"失败回退、退出和低敏审计字段",
		],
	},
});

export type ClinicalSurfacePageData = PatientSurfaceContextData & {
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
};

function toPageData(
	feature: ClinicalSurfaceFeature,
	coverage: MigrationCoverage,
): ClinicalSurfacePageData {
	const definition = CLINICAL_SURFACE_DEFINITIONS[feature];
	return {
		...INITIAL_PATIENT_SURFACE_CONTEXT,
		title: coverage.feature.title,
		icon: coverage.feature.icon,
		readiness: coverage.feature.readiness,
		surfaceLabel: "页面外壳已迁移 · 业务数据待接入",
		description:
			"当前页面已完成原生入口和迁移边界展示，但真实临床数据服务尚未开放。",
		scopeTitle: definition.scopeTitle,
		scopeDescription: definition.scopeDescription,
		boundaryItems: definition.boundaryItems,
		contractItems: definition.contractItems,
		coverageLabel: coverage.coverageLabel,
	};
}

/**
 * 注册四个页面的共同行为，避免页面外壳各自复制导航和状态页逻辑。
 * 该函数不发起业务请求；“选择就诊人”只进入真实选择页，不把选择结果
 * 假装成病历、住院、医生或导诊数据已经可查询。
 */
export function registerClinicalSurfacePage(
	feature: ClinicalSurfaceFeature,
): void {
	const initialCoverage = getFeatureMigrationCoverage(feature);
	Page<ClinicalSurfacePageData, ClinicalSurfacePageMethods>({
		data: toPageData(feature, initialCoverage),
		onLoad() {
			const coverage = getFeatureMigrationCoverage(feature);
			this.setData(toPageData(feature, coverage));
			wx.setNavigationBarTitle({ title: coverage.feature.title });
			void this.loadPatientContext();
		},
		onShow() {
			// 选择页返回后，当前患者可能已经被显式替换；只有首轮读取结束后
			// 才在 onShow 重读，避免 onLoad/onShow 同时制造两次目录请求。
			if (this.data.patientContextLoaded) void this.loadPatientContext();
		},
		loadPatientContext() {
			return loadPatientSurfaceContext(this, `clinical-surface-${feature}`);
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

type ClinicalSurfacePageMethods = {
	loadPatientContext(): Promise<void>;
	onOpenPatientSelector(): void;
	onOpenMigrationStatus(): void;
	onBackHome(): void;
	onRetry(): void;
	onUnload(): void;
};
