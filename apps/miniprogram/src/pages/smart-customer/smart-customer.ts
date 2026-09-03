/**
 * 旧端“智能客服”默认入口实际是一个固定 H5 页面。
 *
 * 这里只恢复默认客服入口，不恢复旧通用 webview 的任意 URL、导诊路径、
 * 患者绑定/解绑路径或 ticket 交换链路；这些入口分别等待自己的 contract。
 * H5 是否能在微信内打开，还取决于小程序后台是否配置业务域名。
 */
const SMART_CUSTOMER_BASE_URL = "https://html.ydrj.top";

function buildSmartCustomerUrl(): string {
	return `${SMART_CUSTOMER_BASE_URL}?timestamp=${Date.now()}`;
}

type SmartCustomerPageData = {
	webViewUrl: string;
};

type SmartCustomerPageMethods = {
	onShow(): void;
};

Page<SmartCustomerPageData, SmartCustomerPageMethods>({
	data: {
		webViewUrl: buildSmartCustomerUrl(),
	},

	/** 切回智能客服入口时重新加载旧端 H5。 */
	onShow(): void {
		this.setData({ webViewUrl: buildSmartCustomerUrl() });
	},
});
