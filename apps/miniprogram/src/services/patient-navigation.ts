import { isPatientSyncInFlight } from "./patient-sync-coordinator";
import { hasPlatformSession } from "./session-service";
import type { SessionVerificationState } from "../types";

/** 兼容已有布尔调用方，同时允许页面传入最近一次 `/me` 验证结果。 */
type AuthenticatedEntryState = SessionVerificationState | boolean;

/** 患者范围页面进入前的三态门禁，页面不能把它们混成一个跳转结果。 */
export type PatientScopedEntryDecision =
	| "redirect-to-login"
	| "select-patient"
	| "open";

export type AuthenticatedEntryDecision =
	| "wait-for-session"
	| "redirect-to-login"
	| "open";

/**
 * 只有明确验证成功才允许进入需要会话的页面。
 *
 * 布尔值仅保留给旧调用点：true 等价于已验证，false 等价于已失效；新页面
 * 应传入四态值，避免把“本地有 token”错误地当作“服务端已登录”。
 */
export function resolveAuthenticatedEntry(
	state: AuthenticatedEntryState,
): AuthenticatedEntryDecision {
	if (state === true || state === "valid") return "open";
	if (state === false || state === "invalid") return "redirect-to-login";
	return "wait-for-session";
}

/**
 * 纯函数判断患者范围页面的入口状态。
 *
 * 未登录必须回到首页建立平台会话；已登录但没有 ready 患者时必须进入
 * 独立选择页；只有两项都满足时才能打开预约记录、爽约或费用页面。把
 * 判断集中在这里，避免不同页面各自复制条件后出现 401 和错误空态。
 */
export function resolvePatientScopedEntry(
	hasSession: boolean,
	hasPatient: boolean,
): PatientScopedEntryDecision {
	if (!hasSession) return "redirect-to-login";
	if (!hasPatient) return "select-patient";
	return "open";
}

/**
 * 打开只要求平台会话的页面。
 *
 * 资料页、患者选择页等页面不一定要求已有患者，但绝不能在没有
 * Bearer 会话时直接发起请求。统一回首页让首页负责微信登录，避免每个
 * 页面各自复制登录按钮或把 401 当成普通空态。
 */
export function navigateToAuthenticatedPage(
	url: string,
	state: AuthenticatedEntryState,
): void {
	const decision = resolveAuthenticatedEntry(state);
	if (decision === "wait-for-session") {
		wx.showToast({ title: "登录状态验证中，请稍后", icon: "none" });
		return;
	}
	if (decision === "redirect-to-login") {
		wx.showToast({ title: "请先登录", icon: "none" });
		wx.reLaunch({ url: "/pages/index/index" });
		return;
	}
	wx.navigateTo({ url });
}

/**
 * 统一进入就诊人选择页。
 *
 * 任何页面都可能在首页后台同步尚未结束时发起“更换就诊人”。统一门禁
 * 避免选择页再次产生第二条同步链；门禁只改善用户入口，真正的并发安全
 * 仍由进程级同步协调器和服务端幂等租约共同保证。没有显式传入四态结果的
 * 旧页面至少实时读取本地 token；这不能证明 token 未过期，但能避免 401 已
 * 清理 token 后仍然把用户送进选择页。
 */
export function navigateToPatientSelector(
	state: AuthenticatedEntryState = hasPlatformSession(),
): void {
	const decision = resolveAuthenticatedEntry(state);
	if (decision !== "open") {
		navigateToAuthenticatedPage("/pages/patient-select/patient-select", state);
		return;
	}
	if (isPatientSyncInFlight()) {
		wx.showToast({ title: "就诊人正在同步，请稍后", icon: "none" });
		return;
	}
	wx.navigateTo({ url: "/pages/patient-select/patient-select" });
}

/**
 * 打开必须绑定当前就诊人的页面。
 *
 * 这里不尝试在入口处读取患者目录：目录读取、同步和 stale 处理属于
 * 选择页/业务页的生命周期。入口只负责把明显不满足前置条件的操作导向
 * 正确页面，避免把未登录或未选患者请求发送到业务 API。
 */
export function navigateToPatientScopedPage(
	url: string,
	state: AuthenticatedEntryState,
	hasPatient: boolean,
): void {
	const sessionDecision = resolveAuthenticatedEntry(state);
	if (sessionDecision !== "open") {
		navigateToAuthenticatedPage(url, state);
		return;
	}
	const decision = resolvePatientScopedEntry(true, hasPatient);
	if (decision === "select-patient") {
		navigateToPatientSelector(state);
		return;
	}
	wx.navigateTo({ url });
}
