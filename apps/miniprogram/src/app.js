App({
	globalData: {
		apiBaseUrl: "http://127.0.0.1:3000",
		accessToken: "",
		selectedPatient: null,
	},

	onLaunch() {
		const storedToken = wx.getStorageSync("access_token");
		if (storedToken) {
			this.globalData.accessToken = storedToken;
		}
	},
});
