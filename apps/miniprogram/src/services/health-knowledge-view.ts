/**
 * 健康百科的“空”有两种含义：
 *
 * 1. 左侧目录本身为空，说明当前发布版本没有可导航的内容，页面可以展示
 *    整体空状态；
 * 2. 左侧仍有分类，但当前分类没有关联条目，此时必须保留左右导航，只在
 *    右侧显示空提示，否则用户无法切换到其它分类。
 *
 * 这个判断与服务端的 published 版本状态无关，只负责页面状态机，避免把
 * “某个分类为空”误处理成“整个健康百科为空”。
 */
export function resolveKnowledgePanelState(
	leftItemCount: number,
): "ready" | "empty" {
	return leftItemCount > 0 ? "ready" : "empty";
}

/**
 * 决定健康百科切换 Tab 时应该复用哪一份目录事实。
 *
 * 左侧“部位”目录既是症状 Tab 的目录，也是疾病 Tab 的默认关系目录，
 * 但“数组为空”不能直接解释成“服务端返回了空目录”：它也可能只是首次
 * 请求失败、当前页面还没有加载过，或者上一轮切换正在被淘汰。若此时直接
 * 调用 `loadSymptoms("")`/`loadDiseases("part", "")`，页面会把未加载或错误
 * 降级成空态，用户既看不到重试原因，也无法恢复目录。
 *
 * 因此只有存在已成功取得的部位目录时才允许读取关联内容；没有缓存时，
 * 两个 Tab 都必须重新取得各自的目录事实。这个决策不涉及内容发布权限，
 * 服务端仍会在没有审核 bundle 时返回 fail-closed 错误。
 */
export type KnowledgeTab = "symptom" | "disease";
export type KnowledgeTabSource =
	| "cached-parts"
	| "reload-symptom-catalog"
	| "reload-disease-catalog";

export function resolveKnowledgeTabSource(
	tab: KnowledgeTab,
	cachedPartCount: number,
): KnowledgeTabSource {
	if (cachedPartCount > 0) return "cached-parts";
	return tab === "symptom"
		? "reload-symptom-catalog"
		: "reload-disease-catalog";
}
