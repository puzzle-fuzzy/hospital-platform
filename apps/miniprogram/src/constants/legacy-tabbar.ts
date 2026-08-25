import type { TabBarItem } from "../types";

/**
 * 四个主入口的唯一底栏事实源。
 *
 * 这组数据只交给微信官方 `custom-tab-bar` 组件渲染；页面自身不复制底栏
 * WXML，也不维护另一份 selected 状态。这样切换主 Tab 时，底栏仍由同一个
 * 小程序组件实例持有，选中图标不会因为页面重建而闪回首页。
 */
export const LEGACY_TAB_BAR_ITEMS = Object.freeze([
	{
		activeIcon: "/assets/legacy-home/tab-01-native-active-v6.png",
		icon: "/assets/legacy-home/tab-01-native-v6.png",
		route: "/pages/index/index",
		text: "医疗服务",
	},
	{
		activeIcon: "/assets/legacy-home/tab-02-native-active-v6.png",
		icon: "/assets/legacy-home/tab-02-native-v6.png",
		route: "/pages/consult/consult",
		text: "就诊",
	},
	{
		activeIcon: "/assets/legacy-home/tab-03-native-active-v6.png",
		icon: "/assets/legacy-home/tab-03-native-v6.png",
		route: "/pages/hospital/hospital",
		text: "互联网医院",
	},
	{
		activeIcon: "/assets/legacy-home/tab-04-native-active-v6.png",
		icon: "/assets/legacy-home/tab-04-native-v6.png",
		route: "/pages/my/my",
		text: "我的",
	},
] satisfies ReadonlyArray<TabBarItem>);
