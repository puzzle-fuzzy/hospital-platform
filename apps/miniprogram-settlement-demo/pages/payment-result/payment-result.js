const DEMO_PAYMENT_RESULT = {
	business: "outpatient",
	channel: "medical",
	businessLabel: "门诊",
	channelLabel: "医保支付",
	hospitalName: "高平市人民医院",
	title: "医保支付成功",
	subtitle: "门诊费用支付及医院结算已确认",
	hasDetail: true,
	amountBreakdownVisible: true,
	amountBreakdownLoading: false,
	amountBreakdownHint: "",
	totalAmountLabel: "41.00元",
	insuranceAmountLabel: "0.00元",
	accountAmountLabel: "40.00元",
	otherInsuranceAmountLabel: "0.00元",
	cashAmountLabel: "1.00元",
};

Page({
	data: DEMO_PAYMENT_RESULT,

	onViewDetail() {
		wx.showToast({
			title: "演示暂无详情",
			icon: "none",
		});
	},

	onBackHome() {
		wx.redirectTo({
			url: "/pages/outpatient-medical-settlement/outpatient-medical-settlement",
		});
	},
});
