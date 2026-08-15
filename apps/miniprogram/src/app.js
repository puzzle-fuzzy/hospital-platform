App({
	globalData: {
		// 开发默认值只适合微信开发者工具；真机请写入可访问的 HTTPS/LAN 地址。
		apiBaseUrl: "http://127.0.0.1:3000",
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
