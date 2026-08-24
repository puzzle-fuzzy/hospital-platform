import { LEGACY_TAB_BAR_ITEMS } from "../constants/legacy-tabbar";

type SharedTabBarData = {
	items: typeof LEGACY_TAB_BAR_ITEMS;
	selected: number;
};

type SharedTabBarMethods = {
	syncSelectedTab(): void;
	onTabTap(event: WechatMiniprogram.TouchEvent): void;
};

/**
	从微信当前页面路由推导激活项，不能由某个页面写死 index。

	`custom-tab-bar` 由微信作为四个主 Tab 的共享组件持有。组件重新显示时
	重新读取当前路由，能够覆盖从普通业务页返回、登录回首页和 tab 页面复用
	等场景；页面不需要也不允许维护另一份 selected 状态。
 */
function resolveSelectedTab(): number {
	const pages = getCurrentPages();
	const currentPage = pages[pages.length - 1] as { route?: string } | undefined;
	const route = currentPage?.route ? `/${currentPage.route}` : "";
	const selected = LEGACY_TAB_BAR_ITEMS.findIndex(
		(item) => item.route === route,
	);
	return selected >= 0 ? selected : 0;
}

Component<SharedTabBarData, Record<never, never>, SharedTabBarMethods>({
	data: {
		items: LEGACY_TAB_BAR_ITEMS,
		// 初始值直接取当前路由，避免组件第一次 attached 时先显示首页激活态，
		// 再异步切换到“我的”而形成肉眼可见的闪动。
		selected: resolveSelectedTab(),
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
			// 当前项没有变化时不调用 setData，避免每次 onShow 都重绘图标和文字。
			if (selected === this.data.selected) return;
			this.setData({ selected });
		},

		onTabTap(event) {
			const index = Number(event.currentTarget?.dataset?.index);
			if (!Number.isInteger(index) || index < 0) return;
			const item = this.data.items[index];
			if (!item || index === this.data.selected) return;
			// 主入口只允许 switchTab；navigateTo 会把 tab 页面压进页面栈，
			// 导致底栏被重新创建或出现第二套底栏。
			wx.switchTab({ url: item.route });
		},
	},
});
