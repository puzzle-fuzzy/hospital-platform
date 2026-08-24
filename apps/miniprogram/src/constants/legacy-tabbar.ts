import type { TabBarItem } from "../types";

/**
 * 四个主入口的唯一事实来源。
 *
 * 这组数据只交给微信官方 `custom-tab-bar` 组件渲染。页面自身不能复制
 * 底栏 WXML，也不能为底栏维护另一份 selected 状态；否则页面切换时会
 * 同时存在多个视觉实例，造成闪动、选中项回到首页或点击穿透。
 */
export const LEGACY_TAB_BAR_ITEMS = Object.freeze([
	{
		activeIcon: "/assets/legacy-home/tab-01-native-active-v5.png",
		icon: "/assets/legacy-home/tab-01-native-v5.png",
		route: "/pages/index/index",
		text: "医疗服务",
	},
	{
		activeIcon: "/assets/legacy-home/tab-02-native-active-v5.png",
		icon: "/assets/legacy-home/tab-02-native-v5.png",
		route: "/pages/consult/consult",
		text: "就诊",
	},
	{
		activeIcon: "/assets/legacy-home/tab-03-native-active-v5.png",
		icon: "/assets/legacy-home/tab-03-native-v5.png",
		route: "/pages/hospital/hospital",
		text: "互联网医院",
	},
	{
		activeIcon: "/assets/legacy-home/tab-04-native-active-v5.png",
		icon: "/assets/legacy-home/tab-04-native-v5.png",
		route: "/pages/my/my",
		text: "我的",
	},
] satisfies ReadonlyArray<TabBarItem>);
