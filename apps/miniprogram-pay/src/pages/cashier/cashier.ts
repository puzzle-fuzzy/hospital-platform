import { readPendingPayment } from "../../services/medical-insurance";

Page({
	data: {
		cashierUrl: "",
		error: "",
	},

	onLoad() {
		const pending = readPendingPayment();
		const url =
			pending?.phase === "medical_cashier"
				? String(pending.cashierUrl || "").trim()
				: "";
		if (!/^https:\/\//i.test(url) || url.length > 2048) {
			this.setData({
				error: "医保收银台地址无效，请返回后重新发起支付",
			});
			return;
		}
		console.info("[医保收银台] 已打开", {
			hasUrl: true,
			urlLength: url.length,
		});
		this.setData({ cashierUrl: url });
	},

	onWebViewError(event: WechatMiniprogram.WebviewError) {
		console.error("[医保收银台] web-view 加载失败", {
			src: event.detail?.src || "unknown",
		});
		this.setData({ error: "医保收银台加载失败，请返回后重试" });
	},
});
