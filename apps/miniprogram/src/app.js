App({
	globalData: {
		// 线上小程序固定访问已备案的 HTTPS 域名，真实业务路由由 apiPrefix 隔离。
		apiBaseUrl: "https://test-hp.meiyi.pro",
		apiPrefix: "/api/v2",
		accessToken: "",
		sessionStatus: "signed_out",
	},

	onLaunch() {
		const storedToken = wx.getStorageSync("access_token");
		if (storedToken) {
			this.globalData.accessToken = storedToken;
			this.globalData.sessionStatus = "signed_in";
		}
	},
});
