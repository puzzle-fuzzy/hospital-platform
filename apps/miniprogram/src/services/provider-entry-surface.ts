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

export type ProviderEntrySurfaceFeature = "blood-appointment";

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

function toPageData(coverage: MigrationCoverage): ProviderEntrySurfacePageData {
	return {
		...INITIAL_PATIENT_SURFACE_CONTEXT,
		title: coverage.feature.title,
		icon: coverage.feature.icon,
		...USER_FACING_SURFACE_COPY,
	};
}

/** 注册预约类 Provider 入口关闭态；真实读取必须先完成引用、owner 和字段白名单契约。 */
export function registerProviderEntrySurfacePage(
	feature: ProviderEntrySurfaceFeature,
): void {
	const initialCoverage = getFeatureMigrationCoverage(feature);
	Page<ProviderEntrySurfacePageData, ProviderEntrySurfacePageMethods>({
		data: toPageData(initialCoverage),
		onLoad() {
			const coverage = getFeatureMigrationCoverage(feature);
			this.setData(toPageData(coverage));
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
