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
		// 开发者工具刚启动或页面栈正在切换时，读取页面栈可能暂时失败；
		// 不把无法读取误判成首页，避免选中态突然跳回第一项。
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
			const selected = resolveSelectedTab();
			if (selected === null) return;
			if (selected === this.data.selected && !this.data.switching) return;
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
			// 先更新唯一底栏实例的选中图标，再切换页面。由于底栏由微信
			// custom-tab-bar 持有，页面切换不会创建第二份底栏，也不会先
			// 让用户看到“无选中态”的中间帧。
			this.setData({
				items: createRuntimeItems(index),
				selected: index,
				switching: true,
			});
			wx.switchTab({
				url: item.route,
				success: () => {
					// 目标页 onShow/pageLifetimes.show 会再次按 route 校正；
					// 这里只释放点击锁，不主动改 selected，避免旧页面的
					// 异步生命周期把即时选中态覆盖回去。
					this.setData({ switching: false });
				},
				fail: () => {
					// 路由失败时回滚视觉状态；不能让底栏看起来已经进入
					// 新页面，避免用户继续点击时产生错误的业务暗示。
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
