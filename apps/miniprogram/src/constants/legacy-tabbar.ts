import type { TabBarItem } from "../types";

/**
 * 四个主 Tab 的唯一视觉事实来源。
 *
 * 微信 custom-tab-bar 由框架挂载在四个 tab 页面之上，页面自身不得复制
 * 底栏 WXML。每个入口同时绑定固定路由和一对本地图标，点击时统一使用
 * `wx.switchTab`，避免把主 Tab 压入普通页面栈后产生第二套底栏。
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
