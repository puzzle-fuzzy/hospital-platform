/**
 * 旧端第三个 Tab 实际承载的是互联网医院固定 H5 页面。
 *
 * 这里只恢复旧端已经确认的单一入口，不接受路由传入 URL，不拼接平台 token，
 * 也不复用旧的通用 ticket 交换链路。外部页面是否能在微信内打开，还取决于
 * 小程序后台是否已将 cx.o2o.bailingjk.net 配置为业务域名。
 */
const INTERNET_HOSPITAL_BASE_URL =
	"https://cx.o2o.bailingjk.net/wechat/#/bluser/userCard/index?publicNoCode=gzh-048400_0001";

function buildInternetHospitalUrl(): string {
	return `${INTERNET_HOSPITAL_BASE_URL}&_t=${Date.now()}`;
}

type HospitalPageData = {
	webViewUrl: string;
};

type HospitalPageMethods = {
	onShow(): void;
};

Page<HospitalPageData, HospitalPageMethods>({
	data: {
		webViewUrl: buildInternetHospitalUrl(),
	},

	/** 切回互联网医院 Tab 时重新加载旧端 H5，保持与旧项目一致。 */
	onShow(): void {
		this.setData({ webViewUrl: buildInternetHospitalUrl() });
	},
});
