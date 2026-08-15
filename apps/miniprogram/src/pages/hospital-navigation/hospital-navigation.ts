type HospitalNavigationPageMethods = {
	onPreviewMap(): void;
	onMapError(): void;
};

/**
 * 院内导航当前是旧端已经存在的静态地图迁移，不是实时导航服务。
 *
 * 旧页面只有本地图片、全屏 aspectFit 和点击预览三个行为；在没有医院
 * 地图数据接口、楼层定位和路线服务契约前，保持这条边界比展示伪造路径更正确。
 */
Page<Record<string, never>, HospitalNavigationPageMethods>({
	data: {},

	onPreviewMap(): void {
		wx.previewImage({
			urls: ["/assets/hospital-navigation/map.jpg"],
			current: "/assets/hospital-navigation/map.jpg",
			fail: () => wx.showToast({ title: "地图预览失败", icon: "none" }),
		});
	},

	onMapError(): void {
		wx.showToast({ title: "地图加载失败，请稍后重试", icon: "none" });
	},
});
