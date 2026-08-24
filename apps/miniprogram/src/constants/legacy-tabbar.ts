import type { TabBarItem } from "../types";

/**
 * 四个主入口的唯一事实来源。
 *
 * 这里的数据只交给微信官方 `custom-tab-bar` 组件渲染。页面自身不能复制
 * 底栏 WXML，也不能为底栏维护另一份 selected 状态；否则页面切换时会出现
 * 两套底栏同时存在、旧实例短暂露出或选中项回到首页等视觉问题。
 */
export const LEGACY_TAB_BAR_ITEMS = Object.freeze([
	{
		activeIcon: "/assets/legacy-home/tab-01-native-active.png",
		icon: "/assets/legacy-home/tab-01-native.png",
		route: "/pages/index/index",
		text: "医疗服务",
	},
	{
		activeIcon: "/assets/legacy-home/tab-02-native-active.png",
		icon: "/assets/legacy-home/tab-02-native.png",
		route: "/pages/consult/consult",
		text: "就诊",
	},
	{
		activeIcon: "/assets/legacy-home/tab-03-native-active.png",
		icon: "/assets/legacy-home/tab-03-native.png",
		route: "/pages/hospital/hospital",
		text: "互联网医院",
	},
	{
		activeIcon: "/assets/legacy-home/tab-04-native-active.png",
		icon: "/assets/legacy-home/tab-04-native.png",
		route: "/pages/my/my",
		text: "我的",
	},
] satisfies ReadonlyArray<TabBarItem>);
