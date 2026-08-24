import { LEGACY_TAB_BAR_ITEMS } from "../constants/legacy-tabbar";

type SharedTabBarData = {
	items: typeof LEGACY_TAB_BAR_ITEMS;
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
	页面栈的 route 才是可靠事实。找不到主 Tab（例如组件初始化过早）时
	先回退到首页，随后在 attached/page show 生命周期再次同步。
*/
function resolveSelectedTab(): number {
	try {
		const pages = getCurrentPages();
		const currentPage = pages[pages.length - 1] as
			| { route?: string }
			| undefined;
		const route = currentPage?.route ? `/${currentPage.route}` : "";
		const selected = LEGACY_TAB_BAR_ITEMS.findIndex(
			(item) => item.route === route,
		);
		return selected >= 0 ? selected : 0;
	} catch {
		// 开发者工具刚启动或页面栈正在切换时，读取页面栈可能暂时失败；
		// 不让底栏渲染异常，只保留可在下一次 show 生命周期恢复的首页态。
		return 0;
	}
}

Component<SharedTabBarData, Record<never, never>, SharedTabBarMethods>({
	data: {
		items: LEGACY_TAB_BAR_ITEMS,
		selected: resolveSelectedTab(),
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
			if (selected === this.data.selected && !this.data.switching) return;
			this.setData({ selected, switching: false });
		},

		onTabTap(event) {
			if (this.data.switching) return;
			const rawIndex = event.currentTarget?.dataset?.index;
			const index = Number(rawIndex);
			if (!Number.isInteger(index) || index < 0) return;

			const item = this.data.items[index];
			if (!item || index === this.data.selected) return;

			const previous = this.data.selected;
			// 先切换组件自己的选中态，再让微信切换页面。底栏是固定的，
			// 因此用户看到的是一次连续的视觉状态变化，而不是旧页面底栏
			// 消失后新页面底栏重新创建的闪帧。
			this.setData({ selected: index, switching: true });
			wx.switchTab({
				url: item.route,
				success: () => {
					this.setData({ switching: false });
				},
				fail: () => {
					// 路由失败时回滚视觉状态；不能让底栏看起来已经进入
					// 新页面，避免用户继续点击时产生错误的业务暗示。
					this.setData({ selected: previous, switching: false });
					this.syncSelectedTab();
				},
			});
		},
	},
});
