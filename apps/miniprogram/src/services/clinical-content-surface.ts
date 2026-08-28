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

export type ClinicalContentSurfaceFeature =
	| "admission-preconsultation"
	| "health-test"
	| "discharge-followup"
	| "gift-banner"
	| "health-praise"
	| "pre-visit"
	| "risk-evaluation";

type ClinicalContentSurfaceDefinition = {
	scopeTitle: string;
	scopeDescription: string;
	boundaryItems: ReadonlyArray<string>;
	contractItems: ReadonlyArray<string>;
	showPatientSelector: boolean;
};

/**
 * 健康内容入口先统一迁移“页面结构 + 关闭态”，不把旧端题库、阈值、
 * 患者答案或上传内容复制到小程序。每个 definition 都保留旧入口的业务
 * 语义，后续接入真实 contract 时只替换状态机，不需要再次改路由。
 */
const CLINICAL_CONTENT_SURFACE_DEFINITIONS: Readonly<
	Record<ClinicalContentSurfaceFeature, ClinicalContentSurfaceDefinition>
> = Object.freeze({
	"admission-preconsultation": {
		scopeTitle: "入院预问诊范围",
		scopeDescription:
			"入院预问诊必须绑定明确的住院事件和版本化问卷，当前不读取旧答案，也不提交医疗问诊。",
		boundaryItems: [
			"问卷版本、患者授权和提交幂等必须同时成立",
			"答案不能被解释为诊断或入院结论",
			"医护读取范围与患者端展示范围分开控制",
		],
		contractItems: [
			"住院事件与问卷版本来源",
			"授权、幂等、撤回和审计字段",
			"临床审核记录与失败语义",
		],
		showPatientSelector: true,
	},
	"health-test": {
		scopeTitle: "健康自测范围",
		scopeDescription:
			"题目、结果和临床解释必须使用经审核的规则版本；当前页面只开放不带结论的本地数值工具。",
		boundaryItems: [
			"题库、阈值和适用人群必须版本化",
			"自测结果不能替代诊断、处方或就医建议",
			"空结果、规则失效和临床审核缺失必须分开提示",
		],
		contractItems: [
			"不可变题库与阈值 bundle",
			"评分规则、免责声明和下线策略",
			"临床审核、回滚和结果保留规则",
		],
		showPatientSelector: false,
	},
	"discharge-followup": {
		scopeTitle: "出院随访范围",
		scopeDescription:
			"随访必须绑定唯一出院事件和任务版本，当前不展示旧端任务，也不覆盖历史答案。",
		boundaryItems: [
			"多次出院不能共用一个随访任务",
			"答案提交必须幂等并可撤回",
			"随访内容与医疗建议、预约状态分开",
		],
		contractItems: [
			"出院事件、任务索引和答案版本",
			"患者授权、提交幂等和撤回规则",
			"临床审核与医护侧读取范围",
		],
		showPatientSelector: true,
	},
	"gift-banner": {
		scopeTitle: "电子锦旗范围",
		scopeDescription:
			"电子锦旗包含提交、审核、公开列表和详情多个状态，当前不上传文件或公开患者内容。",
		boundaryItems: [
			"患者与医护信息必须经过脱敏和审核",
			"上传文件必须校验类型、大小和病毒风险",
			"已发布内容必须具备撤回和失效语义",
		],
		contractItems: [
			"内容审核状态机和公开视图",
			"文件安全、幂等提交和审计日志",
			"撤回、下线和失败重试规则",
		],
		showPatientSelector: true,
	},
	"health-praise": {
		scopeTitle: "表扬信范围",
		scopeDescription:
			"表扬信是审核后的内容记录，不是医疗证明；当前不提交、不公开，也不读取旧端患者快照。",
		boundaryItems: [
			"正文、附件和医护名称必须分别脱敏",
			"审核通过前不能进入公开列表",
			"表扬内容与病历、费用和诊疗结论完全分开",
		],
		contractItems: [
			"内容审核、公开展示和撤回状态",
			"附件安全、幂等和审计字段",
			"患者授权与数据保留周期",
		],
		showPatientSelector: true,
	},
	"pre-visit": {
		scopeTitle: "预约前预问诊范围",
		scopeDescription:
			"预约前预问诊必须绑定具体预约上下文，当前不复用预约目录数据，也不把问卷当预约成功。",
		boundaryItems: [
			"问卷版本和预约关系必须同时有效",
			"答案不能跨预约复用或覆盖",
			"分诊、建议和预约下单保持独立状态机",
		],
		contractItems: [
			"预约上下文与问卷版本来源",
			"患者授权、幂等和医护读取规则",
			"临床审核、失败回退和撤回策略",
		],
		showPatientSelector: true,
	},
	"risk-evaluation": {
		scopeTitle: "风险评估范围",
		scopeDescription:
			"跌倒、疼痛、压力等风险评估必须使用临床审核规则，当前不在客户端计算风险等级。",
		boundaryItems: [
			"题目、阈值和适用人群必须版本化",
			"风险等级不能被包装成诊断结果",
			"规则更新必须支持回滚和结果解释",
		],
		contractItems: [
			"规则 bundle、评分算法和适用人群",
			"免责声明、临床审核和结果授权",
			"服务端计算、回滚和审计字段",
		],
		showPatientSelector: true,
	},
});

export type ClinicalContentSurfacePageData = PatientSurfaceContextData & {
	title: string;
	icon: string;
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
	feature: ClinicalContentSurfaceFeature,
	coverage: MigrationCoverage,
): ClinicalContentSurfacePageData {
	const definition = CLINICAL_CONTENT_SURFACE_DEFINITIONS[feature];
	return {
		...INITIAL_PATIENT_SURFACE_CONTEXT,
		title: coverage.feature.title,
		icon: coverage.feature.icon,
		...USER_FACING_SURFACE_COPY,
		showPatientSelector: definition.showPatientSelector,
	};
}

/** 注册临床内容页面外壳；所有真实问卷、规则和写入请求在 contract 完成前保持关闭。 */
export function registerClinicalContentSurfacePage(
	feature: ClinicalContentSurfaceFeature,
): void {
	const initialCoverage = getFeatureMigrationCoverage(feature);
	Page<ClinicalContentSurfacePageData, ClinicalContentSurfacePageMethods>({
		data: toPageData(feature, initialCoverage),
		onLoad() {
			const coverage = getFeatureMigrationCoverage(feature);
			this.setData(toPageData(feature, coverage));
			wx.setNavigationBarTitle({ title: coverage.feature.title });
			if (CLINICAL_CONTENT_SURFACE_DEFINITIONS[feature].showPatientSelector) {
				void this.loadPatientContext();
			}
		},
		onShow() {
			if (
				CLINICAL_CONTENT_SURFACE_DEFINITIONS[feature].showPatientSelector &&
				this.data.patientContextLoaded
			) {
				void this.loadPatientContext();
			}
		},
		loadPatientContext() {
			return loadPatientSurfaceContext(this, `clinical-content-${feature}`);
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

type ClinicalContentSurfacePageMethods = {
	loadPatientContext(): Promise<void>;
	onOpenPatientSelector(): void;
	onOpenMigrationStatus(): void;
	onBackHome(): void;
	onRetry(): void;
	onUnload(): void;
};
