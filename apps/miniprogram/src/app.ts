export type AppGlobalData = {
	// 线上小程序固定访问已备案的 HTTPS 域名，真实业务路由由 apiPrefix 隔离。
	apiBaseUrl: string;
	apiPrefix: "/api/v2" | "/api/v1";
	accessToken: string;
	sessionStatus: "signed_out" | "signed_in";
};

/** 原生小程序全局状态只保存平台地址和 opaque 会话，不保存 provider 身份。 */
App<{ globalData: AppGlobalData }>({
	globalData: {
		apiBaseUrl: "https://test-hp.meiyi.pro",
		apiPrefix: "/api/v2",
		accessToken: "",
		sessionStatus: "signed_out",
	},

	onLaunch() {
		const storedToken = wx.getStorageSync("access_token");
		if (typeof storedToken === "string" && storedToken) {
			this.globalData.accessToken = storedToken;
			this.globalData.sessionStatus = "signed_in";
		}
	},
});
