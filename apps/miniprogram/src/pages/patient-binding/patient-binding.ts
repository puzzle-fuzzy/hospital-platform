import { buildBailingPatientCardUrl } from "../../services/bailing-patient-card";
import { switchToPrimaryTab } from "../../services/patient-navigation";
import {
	disposePageSessionResetListener,
	registerPageSessionResetListener,
} from "../../services/session-events";
import { hasPlatformSession } from "../../services/session-service";

type PatientBindingPageData = {
	webViewUrl: string;
	error: string;
};

type PatientBindingPageMethods = {
	openPatientCard(): void;
	onRetry(): void;
	onWebViewError(): void;
	onBack(): void;
};

Page<PatientBindingPageData, PatientBindingPageMethods>({
	data: {
		webViewUrl: "",
		error: "",
	},

	onLoad() {
		wx.setNavigationBarTitle({ title: "公众号就诊人绑定" });
		registerPageSessionResetListener(this, () => {
			this.setData({
				webViewUrl: "",
				error: "登录状态已更新，请返回后重新进入",
			});
		});
		this.openPatientCard();
	},

	openPatientCard() {
		if (!hasPlatformSession()) {
			this.setData({
				webViewUrl: "",
				error: "登录状态已失效，请返回首页重新登录",
			});
			return;
		}
		// 暂停小程序内查档、建档和绑卡，交由百灵公众号页面完成。
		// 从这里返回选择页后，由原有返回标记触发一次真实目录同步；
		// 不根据网页加载或 message 事件宣称绑定成功。
		this.setData({ webViewUrl: buildBailingPatientCardUrl(), error: "" });
	},

	onRetry() {
		this.openPatientCard();
	},

	onWebViewError() {
		this.setData({
			webViewUrl: "",
			error:
				"公众号绑定页面暂时无法打开，请重试，或前往高平市人民医院公众号完成绑定后返回小程序刷新就诊人。",
		});
	},

	onBack() {
		wx.navigateBack({
			delta: 1,
			fail: () => switchToPrimaryTab("/pages/index/index"),
		});
	},

	onUnload() {
		disposePageSessionResetListener(this);
	},
});
