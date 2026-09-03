type AppGlobalData = {
	authCode: string;
	insuranceAuthExtraData: Record<string, unknown> | null;
};

App<{ globalData: AppGlobalData }>({
	globalData: { authCode: "", insuranceAuthExtraData: null },
	onShow(options) {
		const extraData = options?.referrerInfo?.extraData;
		const authCode = String(
			extraData?.authCode || extraData?.qrcode || "",
		).trim();
		if (authCode) {
			this.globalData.authCode = authCode;
			this.globalData.insuranceAuthExtraData = extraData || null;
		}
	},
});
