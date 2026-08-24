/**
	“互联网医院”主 Tab 目前只承载迁移边界。
	旧端外部 web-view 的域名、登录态、支付回跳和真机验收尚未重新冻结，
	因此这里不复制旧地址，也不把静态提示包装成已可用的互联网医院服务。
*/
import { syncPrimaryTabSelected } from "../../services/patient-navigation";

type HospitalPageData = Record<string, never>;
type HospitalPageMethods = Record<never, never>;

Page<HospitalPageData, HospitalPageMethods>({
	data: {},
	onShow() {
		syncPrimaryTabSelected(2);
	},
});
