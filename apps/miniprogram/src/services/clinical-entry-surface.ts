import {
	type FeatureKey,
	getFeatureUserFacingCopy,
	navigateToFeatureStatus,
} from "./feature-navigation";
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

export type ClinicalSurfaceFeature =
	| "medical-record"
	| "inpatient-center"
	| "electronic-consultation";

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

function toPageData(coverage: MigrationCoverage): ClinicalSurfacePageData {
	const copy = getFeatureUserFacingCopy(coverage.feature);
	return {
		...INITIAL_PATIENT_SURFACE_CONTEXT,
		title: coverage.feature.title,
		icon: coverage.feature.icon,
		readiness: coverage.feature.readiness,
		...USER_FACING_SURFACE_COPY,
		surfaceLabel: copy.badge,
		description: copy.description,
		scopeTitle: "当前状态",
		scopeDescription: copy.progress,
	};
}

/**
 * 注册三个仍使用统一状态外壳的页面行为，避免页面外壳各自复制导航和状态页逻辑。
 * 该函数不发起业务请求；“选择就诊人”只进入真实选择页，不把选择结果
 * 假装成病历、住院或导诊数据已经可查询。
 */
export function registerClinicalSurfacePage(
	feature: ClinicalSurfaceFeature,
): void {
	const initialCoverage = getFeatureMigrationCoverage(feature);
	Page<ClinicalSurfacePageData, ClinicalSurfacePageMethods>({
		data: toPageData(initialCoverage),
		onLoad() {
			const coverage = getFeatureMigrationCoverage(feature);
			this.setData(toPageData(coverage));
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
