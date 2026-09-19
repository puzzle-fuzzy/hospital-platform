const DEMO_SETTLEMENT = {
	hospitalName: "高平市人民医院",
	totalFen: 4100,
	insuranceFen: 0,
	accountFen: 4000,
	otherInsuranceFen: 0,
	cashFen: 100,
};

function formatFen(value) {
	return `${(value / 100).toFixed(2)}元`;
}

Page({
	data: {
		loading: true,
		error: "",
		hospitalName: DEMO_SETTLEMENT.hospitalName,
		totalAmountLabel: formatFen(DEMO_SETTLEMENT.totalFen),
		insuranceAmountLabel: formatFen(DEMO_SETTLEMENT.insuranceFen),
		accountAmountLabel: formatFen(DEMO_SETTLEMENT.accountFen),
		otherInsuranceAmountLabel: formatFen(DEMO_SETTLEMENT.otherInsuranceFen),
		cashAmountLabel: formatFen(DEMO_SETTLEMENT.cashFen),
		cashAmountValue: (DEMO_SETTLEMENT.cashFen / 100).toFixed(2),
		paymentBusy: false,
		paymentCompleted: false,
		detailVisible: false,
	},

	onLoad() {
		this.loadDemoSettlement();
	},

	loadDemoSettlement() {
		this.setData({
			loading: true,
			error: "",
		});

		setTimeout(() => {
			this.setData({
				loading: false,
			});
		}, 650);
	},

	onPay() {
		if (this.data.paymentBusy) return;
		if (this.data.paymentCompleted) {
			wx.navigateTo({ url: "/pages/payment-result/payment-result" });
			return;
		}

		this.setData({
			paymentBusy: true,
		});

		setTimeout(() => {
			this.setData({
				paymentBusy: false,
				paymentCompleted: true,
			});
			wx.showToast({
				title: "演示支付成功",
				icon: "success",
			});
		}, 900);
	},

	onViewDetail() {
		this.setData({ detailVisible: true });
	},

	onCloseDetail() {
		this.setData({ detailVisible: false });
	},

	noop() {
		// 阻止点击弹窗内容时触发遮罩关闭。
	},

	onBack() {
		this.loadDemoSettlement();
	},
});
