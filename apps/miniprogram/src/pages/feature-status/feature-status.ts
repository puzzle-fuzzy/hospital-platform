import {
	resolveFeatureStatus,
	type FeatureStatusKey,
} from "../../services/feature-navigation";

type FeatureStatusPageData = {
	feature: ReturnType<typeof resolveFeatureStatus>["feature"];
	featureKey: FeatureStatusKey;
};

type FeatureStatusPageOptions = {
	feature?: string;
};

const initialStatus = resolveFeatureStatus();

Page<FeatureStatusPageData, Record<never, never>>({
	data: {
		feature: initialStatus.feature,
		featureKey: initialStatus.featureKey,
	},

	onLoad(options: FeatureStatusPageOptions) {
		const { feature, featureKey } = resolveFeatureStatus(options?.feature);
		this.setData({
			feature,
			featureKey,
		});
		wx.setNavigationBarTitle({ title: feature.title });
	},
});
