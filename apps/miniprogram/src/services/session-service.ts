import type {
	AuthSessionResponse,
	CurrentUserResponse,
	SessionLabel,
	SessionVerificationState,
} from "../types";
import {
	ApiError,
	getCurrentUser,
	isUsableAccessToken,
	login,
} from "./api-client";

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
 * 将“完成 `/me` 验证后的后续读取错误”映射为页面入口状态。
 *
 * `sessionVerificationStateFromError` 只适合 `/me` 或登录恢复本身：那时
 * 请求失败就是会话验证没有完成。患者目录、报告、挂号和费用读取不同，
 * 它们可能只因为没有患者、没有临床映射、Provider 暂时不可用或返回空
 * 结果而失败；这些业务错误不能覆盖已经确认的 `valid`，否则“更换就诊人”
 * 会被错误地拦截。只有明确的 401、会话代际变化，或恢复过程中已经没有
 * 可用 token 时，才允许改变入口门禁。
 */
export function sessionStateAfterAuthenticatedReadError(
	error: unknown,
	currentState: SessionVerificationState,
	sessionStillPresent: boolean,
): SessionVerificationState {
	// `/me` 已经失败时，调用方在前置 Promise 的 rejection 分支中写入了
	// 权威状态；后续 catch 不能再用业务错误把 invalid 改成
	// unavailable，也不能把 unavailable 误报成 valid。
	if (currentState !== "valid") return currentState;
	if (error instanceof ApiError && error.code === "unauthorized") {
		return "invalid";
	}
	if (error instanceof ApiError && error.code === "session-changed") {
		return "checking";
	}
	if (!sessionStillPresent) return sessionVerificationStateFromError(error);
	return "valid";
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
	return (
		isUsableAccessToken(appData.accessToken) ||
		isUsableAccessToken(wx.getStorageSync("access_token"))
	);
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
