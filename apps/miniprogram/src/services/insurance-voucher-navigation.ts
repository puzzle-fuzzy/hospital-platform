/**
 * 旧端“我的 → 医保电子凭证”的真实行为是跳转到医保电子凭证小程序。
 *
 * 这是固定的外部受众入口，不是医保支付订单，也不携带患者、订单或平台会话
 * 数据。医保支付页使用的授权小程序 AppID 属于另一条流程，不能在这里混用。
 */
export const INSURANCE_VOUCHER_APP_ID = "wx81ce904580cc0ff1";

/** 按旧端行为打开医保电子凭证小程序；失败时给出可理解的用户反馈。 */
export function navigateToInsuranceVoucher(): void {
	wx.navigateToMiniProgram({
		appId: INSURANCE_VOUCHER_APP_ID,
		path: "",
		extraData: {},
		fail: (error) => {
			console.error("医保电子凭证小程序跳转失败", error);
			wx.showToast({ title: "跳转失败", icon: "none" });
		},
	});
}
