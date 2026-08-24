import type { TabBarItem } from "../types";

/**
 * 旧端四个底部 Tab 的唯一事实来源。
 *
 * 这组资源只由根目录 `custom-tab-bar` 组件渲染；页面本身不得再复制
 * 底栏 WXML。每一项同时绑定唯一的 tab 页面路由，点击时必须使用
 * `wx.switchTab`，不能用 `navigateTo` 把 tab 页面堆进普通页面栈。
 */
export const LEGACY_TAB_BAR_ITEMS = Object.freeze([
	{
		activeIcon: "/assets/legacy-home/tab-01-active.png",
		icon: "/assets/legacy-home/tab-01.png",
		route: "/pages/index/index",
		text: "医疗服务",
	},
	{
		activeIcon: "/assets/legacy-home/tab-02-active.png",
		icon: "/assets/legacy-home/tab-02.png",
		route: "/pages/consult/consult",
		text: "就诊",
	},
	{
		activeIcon: "/assets/legacy-home/tab-03-active.png",
		icon: "/assets/legacy-home/tab-03.png",
		route: "/pages/hospital/hospital",
		text: "互联网医院",
	},
	{
		activeIcon: "/assets/legacy-home/tab-04-active.png",
		icon: "/assets/legacy-home/tab-04.png",
		route: "/pages/my/my",
		text: "我的",
	},
] satisfies ReadonlyArray<TabBarItem>);
