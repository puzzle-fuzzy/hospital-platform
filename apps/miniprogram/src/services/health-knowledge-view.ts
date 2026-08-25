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
