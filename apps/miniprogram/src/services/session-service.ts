import { getCurrentUser, login } from "./api-client";
import type { AuthSessionResponse, CurrentUserResponse } from "../types";

/** 会话状态只在这一层写入全局，页面层只消费本地化后的显示文案。 */
export const SESSION_STATES = Object.freeze({
	signedOut: "signed_out",
	signedIn: "signed_in",
} as const);

export type SessionState = (typeof SESSION_STATES)[keyof typeof SESSION_STATES];

function globalData(): { accessToken: string; sessionStatus: SessionState } {
	return (
		getApp() as unknown as {
			globalData: { accessToken: string; sessionStatus: SessionState };
		}
	).globalData;
}

/** 判断是否存在可尝试恢复的平台 token。 */
export function hasPlatformSession(): boolean {
	const appData = globalData();
	return Boolean(appData.accessToken || wx.getStorageSync("access_token"));
}

function setSessionState(state: SessionState): void {
	globalData().sessionStatus = state;
}

/** 验证服务端当前用户后再标记会话恢复成功。 */
export function restorePlatformSession(): Promise<CurrentUserResponse> {
	return getCurrentUser().then((payload) => {
		setSessionState(SESSION_STATES.signedIn);
		return payload;
	});
}

/** 完成微信临时 code 兑换后标记平台会话。 */
export function signInPlatformSession(): Promise<AuthSessionResponse> {
	return login().then((payload) => {
		setSessionState(SESSION_STATES.signedIn);
		return payload;
	});
}
