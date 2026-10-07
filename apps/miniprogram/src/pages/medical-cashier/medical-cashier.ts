import { queryMedicalOrder } from "../../services/medical-insurance";
import {
	disposePageSessionResetListener,
	registerPageSessionResetListener,
} from "../../services/session-events";

type MedicalCashierPageData = {
	cashierUrl: string;
	error: string;
};

type MedicalCashierPageMethods = {
	onLoad(options: Record<string, string | undefined>): void;
	loadCashier(orderId: string): Promise<void>;
	onWebViewError(): void;
	onUnload(): void;
};

function decodeRouteValue(value: string | undefined): string {
	if (typeof value !== "string") return "";
	try {
		return decodeURIComponent(value).trim();
	} catch {
		return "";
	}
}

Page<MedicalCashierPageData, MedicalCashierPageMethods>({
	data: {
		cashierUrl: "",
		error: "",
	},

	onLoad(options) {
		registerPageSessionResetListener(this, () => {
			this.setData({
				cashierUrl: "",
				error: "登录状态已更新，请返回后重新选择就诊人",
			});
		});
		const orderId = decodeRouteValue(options.orderId);
		if (!orderId) {
			this.setData({ error: "医保订单引用无效，请返回后重新查询原订单" });
			return;
		}
		void this.loadCashier(orderId);
	},

	async loadCashier(orderId) {
		try {
			const order = await queryMedicalOrder(orderId);
			const url = String(order.cashierUrl || "").trim();
			if (!/^https:\/\//iu.test(url) || url.length > 2048) {
				this.setData({
					error: "医保收银台地址无效，请返回后重新查询原订单",
				});
				return;
			}
			this.setData({ cashierUrl: url, error: "" });
		} catch {
			this.setData({
				cashierUrl: "",
				error: "医保收银台状态查询失败，请返回后重试",
			});
		}
	},

	onWebViewError() {
		this.setData({ error: "医保收银台加载失败，请返回后重试" });
	},

	onUnload() {
		disposePageSessionResetListener(this);
	},
});
