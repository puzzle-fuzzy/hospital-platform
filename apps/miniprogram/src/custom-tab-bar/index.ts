import { LEGACY_TAB_BAR_ITEMS } from "../constants/legacy-tabbar";

type SharedTabBarData = {
	items: Array<(typeof LEGACY_TAB_BAR_ITEMS)[number] & { selected: boolean }>;
	selected: number;
	switching: boolean;
};

type SharedTabBarMethods = {
	syncSelectedTab(): void;
	onTabTap(event: WechatMiniprogram.TouchEvent): void;
};

/**
	根据当前页面路由计算选中项。

	选中状态不能由某个页面写死为 0 或 3：微信从任意主 Tab 切换时，当前
	页面栈的 route 才是可靠事实。找不到主 Tab 时返回 null，不覆盖用户刚刚
	点击产生的即时选中态；等目标页面的 show 生命周期到达后再由路由校正。
*/
function resolveSelectedTab(): number | null {
	try {
		const pages = getCurrentPages();
		const currentPage = pages[pages.length - 1] as
			| { route?: string }
			| undefined;
		const route = currentPage?.route ? `/${currentPage.route}` : "";
		const selected = LEGACY_TAB_BAR_ITEMS.findIndex(
			(item) => item.route === route,
		);
		return selected >= 0 ? selected : null;
	} catch {
		// 页面栈正在切换时读取可能暂时失败；不能把未知状态误判成首页，
		// 否则点击“我的”时底栏会先闪回第一项。
		return null;
	}
}

/** WXML 直接消费每一项的 selected 字段，避免切换首帧依赖索引比较表达式。 */
function createRuntimeItems(selected: number) {
	return LEGACY_TAB_BAR_ITEMS.map((item, index) => ({
		...item,
		selected: index === selected,
	}));
}

/** 页面首次创建时尽量从当前 route 初始化；无法读取时才安全落到首页。 */
function runtimeSelectedOrDefault(): number {
	return resolveSelectedTab() ?? 0;
}

Component<SharedTabBarData, Record<never, never>, SharedTabBarMethods>({
	data: {
		selected: runtimeSelectedOrDefault(),
		items: createRuntimeItems(runtimeSelectedOrDefault()),
		switching: false,
	},

	lifetimes: {
		attached() {
			this.syncSelectedTab();
		},
	},

	pageLifetimes: {
		show() {
			this.syncSelectedTab();
		},
	},

	methods: {
		syncSelectedTab() {
			// switchTab 的过渡期里，getCurrentPages() 可能仍然返回旧页面。
			// 此时不能用旧 route 覆盖用户刚点击的新选中态；切换成功后由
			// 当前目标页面的下一次 show 生命周期再校正。
			if (this.data.switching) return;
			const selected = resolveSelectedTab();
			if (selected === null || selected === this.data.selected) return;
			this.setData({
				items: createRuntimeItems(selected),
				selected,
				switching: false,
			});
		},

		onTabTap(event) {
			if (this.data.switching) return;
			const rawIndex = event.currentTarget?.dataset?.index;
			const index = Number(rawIndex);
			if (!Number.isInteger(index) || index < 0) return;

			const item = this.data.items[index];
			if (!item || index === this.data.selected) return;

			const previous = this.data.selected;
			// 先更新唯一底栏实例的选中图标，再切换页面。切换期间保持锁定，
			// 防止旧页面 show 生命周期把新选中态回写成旧项。
			this.setData({
				items: createRuntimeItems(index),
				selected: index,
				switching: true,
			});
			wx.switchTab({
				url: item.route,
				success: () => {
					// switchTab 成功表示目标路由已被微信接受。这里不能再次按
					// 旧页面栈计算 selected，否则会制造“选中-回退-再选中”的闪帧；
					// 目标页后续 show 会负责最终校正。
					this.setData({ switching: false });
				},
				fail: () => {
					// 路由失败时回滚视觉状态；不能让底栏看起来已经进入新页。
					this.setData({
						items: createRuntimeItems(previous),
						selected: previous,
						switching: false,
					});
					this.syncSelectedTab();
				},
			});
		},
	},
});
