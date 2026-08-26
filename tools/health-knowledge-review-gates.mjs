/**
 * 健康知识从旧源快照进入患者端前的统一审核门。
 *
 * staging 导入、发布/撤回演练和真机验收是三个不同事实：前者证明事务
 * 写入，第二个证明版本状态机，第三个证明患者端看到的是正确版本。两个
 * 审计工具必须引用同一份定义，不能各自维护一套容易漂移的字符串。
 */
export const HEALTH_KNOWLEDGE_REVIEW_GATE_IDS = Object.freeze({
	sourceQuality: "source-quality",
	clinicalReview: "clinical-review",
	bundleMetadata: "bundle-metadata",
	stagingImport: "staging-import",
	publicationDrill: "publication-drill",
	deviceAcceptance: "device-acceptance",
});
