import type { TabBarItem } from "../types";

/**
 * 旧端四个底部 Tab 的唯一事实来源。
 *
 * “首页”和“我的”都会渲染这组资源；如果两个页面各自维护一份数组，
 * 后续很容易出现图标顺序、激活态或文案不一致。这里仅保存展示契约，
 * 页面是否允许跳转仍由各自的业务入口决定。
 */
export const LEGACY_TAB_BAR_ITEMS = Object.freeze([
	{
		activeIcon: "/assets/legacy-home/tab-01-active.png",
		icon: "/assets/legacy-home/tab-01.png",
		text: "医疗服务",
	},
	{
		activeIcon: "/assets/legacy-home/tab-02-active.png",
		icon: "/assets/legacy-home/tab-02.png",
		text: "就诊",
	},
	{
		activeIcon: "/assets/legacy-home/tab-03-active.png",
		icon: "/assets/legacy-home/tab-03.png",
		text: "互联网医院",
	},
	{
		activeIcon: "/assets/legacy-home/tab-04-active.png",
		icon: "/assets/legacy-home/tab-04.png",
		text: "我的",
	},
] satisfies ReadonlyArray<TabBarItem>);
