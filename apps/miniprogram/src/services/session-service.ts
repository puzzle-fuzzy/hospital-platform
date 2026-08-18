import { ApiError, getCurrentUser, login } from "./api-client";
import type {
	AuthSessionResponse,
	CurrentUserResponse,
	SessionLabel,
	SessionVerificationState,
} from "../types";

/** 会话状态只在这一层写入全局，页面层只消费本地化后的显示文案。 */
export const SESSION_STATES = Object.freeze({
	signedOut: "signed_out",
	signedIn: "signed_in",
} as const);

export type SessionState = (typeof SESSION_STATES)[keyof typeof SESSION_STATES];

/** 将会话验证异常收敛成页面可消费的状态，临时故障不等同于退出登录。 */
export function sessionVerificationStateFromError(
	error: unknown,
): Exclude<SessionVerificationState, "checking" | "valid"> {
	if (error instanceof ApiError && error.code === "unauthorized") {
		return "invalid";
	}
	return "unavailable";
}

/**
 * 将首页展示文案映射回真正的入口门禁状态。
 *
 * 首页的中文状态是给用户看的，不能让各个按钮自行猜测“有 token 就算登录”。
 * 这里集中定义四态边界：恢复中只能等待，恢复成功才可进入，明确失效才回登录，
 * 依赖暂时不可用时保留会话并提示重试。
 */
export function sessionVerificationStateFromLabel(
	label: SessionLabel,
): SessionVerificationState {
	switch (label) {
		case "验证会话中":
			return "checking";
		case "已恢复会话":
		case "已登录":
			return "valid";
		case "未登录":
			return "invalid";
		case "会话暂不可用":
			return "unavailable";
	}
}

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
