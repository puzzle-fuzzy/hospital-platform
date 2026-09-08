import { readPendingPayment } from "../../services/medical-insurance";
import {
	disposePageSessionResetListener,
	registerPageSessionResetListener,
} from "../../services/session-events";

type MedicalCashierPageData = {
	cashierUrl: string;
	error: string;
};

type MedicalCashierPageMethods = {
	onLoad(): void;
	onWebViewError(): void;
	onUnload(): void;
};

Page<MedicalCashierPageData, MedicalCashierPageMethods>({
	data: {
		cashierUrl: "",
		error: "",
	},

	onLoad() {
		registerPageSessionResetListener(this, () => {
			this.setData({
				cashierUrl: "",
				error: "登录状态已更新，请返回后重新选择就诊人",
			});
		});
		const pending = readPendingPayment();
		const url =
			pending?.phase === "medical_cashier"
				? String(pending.cashierUrl || "").trim()
				: "";
		if (!/^https:\/\//iu.test(url) || url.length > 2048) {
			this.setData({ error: "医保收银台地址无效，请返回后重新发起支付" });
			return;
		}
		this.setData({ cashierUrl: url });
	},

	onWebViewError() {
		this.setData({ error: "医保收银台加载失败，请返回后重试" });
	},

	onUnload() {
		disposePageSessionResetListener(this);
	},
});
