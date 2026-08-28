import {
	type FeatureStatusKey,
	getFeatureUserFacingCopy,
	resolveFeatureStatus,
} from "../../services/feature-navigation";
import { getFeatureMigrationCoverage } from "../../services/migration-coverage";

type FeatureStatusPageData = {
	feature: ReturnType<typeof resolveFeatureStatus>["feature"];
	featureCopy: ReturnType<typeof getFeatureUserFacingCopy>;
	featureKey: FeatureStatusKey;
	coverage: ReturnType<typeof getFeatureMigrationCoverage> | null;
};

type FeatureStatusPageOptions = {
	feature?: string;
};

type FeatureStatusPageMethods = {
	/** 状态页不是终点，用户可以返回共享主 Tab。 */
	onBackHome(): void;
};

const initialStatus = resolveFeatureStatus();

Page<FeatureStatusPageData, FeatureStatusPageMethods>({
	data: {
		feature: initialStatus.feature,
		featureCopy: getFeatureUserFacingCopy(initialStatus.feature),
		featureKey: initialStatus.featureKey,
		coverage:
			initialStatus.featureKey === "invalid-entry"
				? null
				: getFeatureMigrationCoverage(initialStatus.featureKey),
	},

	onLoad(options: FeatureStatusPageOptions) {
		const { feature, featureKey } = resolveFeatureStatus(options?.feature);
		this.setData({
			feature,
			featureCopy: getFeatureUserFacingCopy(feature),
			featureKey,
			coverage:
				featureKey === "invalid-entry"
					? null
					: getFeatureMigrationCoverage(featureKey),
		});
		wx.setNavigationBarTitle({ title: feature.title });
	},

	/** 状态页不是终点，用户应能从任意阻塞入口回到共享主 Tab。 */
	onBackHome() {
		wx.switchTab({ url: "/pages/index/index" });
	},
});
