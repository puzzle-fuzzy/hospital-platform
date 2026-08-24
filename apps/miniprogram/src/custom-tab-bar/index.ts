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
	共享底栏的激活态只能由当前 tab 页路由推导。

	不能由首页或“我的”页面各自写死 `index === 0/3`：一旦用户从微信
	底栏切到第二、第三个根页面，旧页面的 data 不会替新页面维护激活态。
	组件在 attached 和所在页面 show 时都重新读取 route，保证回到 tab 页时
	激活态与真实页面一致。
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
		selected: 0,
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
			this.setData({ selected: resolveSelectedTab() });
		},

		onTabTap(event) {
			const index = Number(event.currentTarget?.dataset?.index);
			if (!Number.isInteger(index) || index < 0) return;
			const item = this.data.items[index];
			if (!item) return;
			// 主入口必须使用 switchTab。navigateTo 会产生新的页面栈和重复底栏，
			// 正是旧实现中点击“我的”后出现两套底栏的根因。
			if (index === this.data.selected) return;
			wx.switchTab({ url: item.route });
		},
	},
});
