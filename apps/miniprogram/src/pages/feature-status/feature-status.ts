import {
	FEATURE_STATUS_CATALOG,
	type FeatureKey,
	type FeatureStatus,
} from "../../services/feature-navigation";

type FeatureStatusPageData = {
	feature: FeatureStatus;
	featureKey: string;
};

type FeatureStatusPageOptions = {
	feature?: string;
};

/**
 * 把未知 query 收敛到安全的默认页，避免外部深链伪造标题、图片或业务
 * 文案。真正的业务入口仍须通过 feature-navigation 的固定 key 打开。
 */
function resolveFeatureKey(value?: string): FeatureKey {
	if (value && Object.hasOwn(FEATURE_STATUS_CATALOG, value)) {
		return value as FeatureKey;
	}
	return "medical-record";
}

Page<FeatureStatusPageData, Record<never, never>>({
	data: {
		feature: FEATURE_STATUS_CATALOG["medical-record"],
		featureKey: "medical-record",
	},

	onLoad(options: FeatureStatusPageOptions) {
		const featureKey = resolveFeatureKey(options?.feature);
		const feature = FEATURE_STATUS_CATALOG[featureKey];
		this.setData({
			feature,
			featureKey,
		});
		wx.setNavigationBarTitle({ title: feature.title });
	},
});
