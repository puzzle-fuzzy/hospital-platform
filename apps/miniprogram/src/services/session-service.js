import { getCurrentUser, login } from "./api-client";

/** 会话状态只在这一层写入全局，页面层只消费本地化后的显示文案。 */
export const SESSION_STATES = Object.freeze({
	signedOut: "signed_out",
	signedIn: "signed_in",
});

/**
 * 判断是否存在可尝试恢复的平台 token。
 * token 只属于 Hospital API；这里不会解析 JWT，也不会读取 provider 身份。
 */
export function hasPlatformSession() {
	const app = getApp();
	return Boolean(
		app.globalData.accessToken || wx.getStorageSync("access_token"),
	);
}

/** @param {"signed_out"|"signed_in"} state */
function setSessionState(state) {
	getApp().globalData.sessionStatus = state;
}

/** 验证服务端当前用户后再标记会话恢复成功。 */
export function restorePlatformSession() {
	return getCurrentUser().then((payload) => {
		setSessionState(SESSION_STATES.signedIn);
		return payload;
	});
}

/** 完成微信临时 code 兑换后标记平台会话；token 持久化由 api-client 处理。 */
export function signInPlatformSession() {
	return login().then((payload) => {
		setSessionState(SESSION_STATES.signedIn);
		return payload;
	});
}
