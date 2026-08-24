import type { Patient, SessionVerificationState } from "../types";
import { isCurrentSelectedPatient } from "./patient-selection-service";
import { isPatientSyncInFlight } from "./patient-sync-coordinator";

/**
 * 所有受保护入口必须使用最近一次 `/me` 验证结果。
 *
 * 不能再接受 boolean 或默认读取本地 token：本地 token 只代表设备上存在
 * 一个待尝试的凭证，不能证明服务端仍接受该凭证，也不能证明它属于当前
 * 会话代际。这样把入口状态收紧到四态后，所有页面都必须显式处理验证中、
 * 已验证、已失效和暂不可用四种真实业务状态。
 */
type AuthenticatedEntryState = SessionVerificationState;

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
 * 实际导航动作的结果，供需要维持页面状态的调用方消费。
 *
 * `open` 只描述门禁判断，不代表微信导航已经启动；这里把“等待验证”、
 * “回首页”和“已发起 navigateTo”区分开，避免页面在入口被拦截后继续显示
 * 永久 loading。尤其是患者同步进行中时，调用方必须回到可重试的错误态。
 */
export type AuthenticatedNavigationResult =
	| "waiting-for-session"
	| "redirected-to-login"
	| "navigated";

/** 患者选择页入口的具体结果，额外保留跨页面同步阻塞这一种业务状态。 */
export type PatientSelectorNavigationResult =
	| AuthenticatedNavigationResult
	| "sync-in-flight";

/**
 * 只有明确验证成功才允许进入需要会话的页面。
 */
export function resolveAuthenticatedEntry(
	state: AuthenticatedEntryState,
): AuthenticatedEntryDecision {
	if (state === "valid") return "open";
	if (state === "invalid") return "redirect-to-login";
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
 * 患者范围入口必须使用“当前可临床查询”的显式选择。
 *
 * 页面对象存在不等于患者上下文仍然有效：目录刷新可能已经把临床映射
 * 置为 unavailable，另一个页面也可能刚刚把 storage 中的显式选择换成了
 * 另一位患者。入口层先拦截这两种中间态，避免用户先进入业务页再看到一
 * 个必然失败的请求；业务页自己的 owner、会话代际和响应校验仍然保留，
 * 这里不是对服务端授权的替代。
 *
 * 第二个参数仅供纯测试传入 storage 快照，生产调用省略它并读取微信
 * storage 中的当前 opaque patientId。
 */
export function hasCurrentPatientContext(
	patient: Pick<Patient, "id" | "clinicalAccess"> | null,
	storedPatientId?: string,
): boolean {
	return Boolean(
		patient &&
			patient.clinicalAccess === "ready" &&
			isCurrentSelectedPatient(patient.id, storedPatientId),
	);
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
): AuthenticatedNavigationResult {
	const decision = resolveAuthenticatedEntry(state);
	if (decision === "wait-for-session") {
		wx.showToast({
			title:
				state === "unavailable"
					? "登录服务暂不可用，请稍后重试"
					: "登录状态验证中，请稍后",
			icon: "none",
		});
		return "waiting-for-session";
	}
	if (decision === "redirect-to-login") {
		wx.showToast({ title: "请先登录", icon: "none" });
		wx.reLaunch({ url: "/pages/index/index" });
		return "redirected-to-login";
	}
	wx.navigateTo({ url });
	return "navigated";
}

/**
 * 统一进入就诊人选择页。
 *
 * 任何页面都可能在首页后台同步尚未结束时发起“更换就诊人”。统一门禁
 * 避免选择页再次产生第二条同步链；门禁只改善用户入口，真正的并发安全
 * 仍由进程级同步协调器和服务端幂等租约共同保证。调用方必须传入最近一次
 * `/me` 验证状态，不能用本地 token 存在与否替代服务端认证事实。
 */
export function navigateToPatientSelector(
	state: AuthenticatedEntryState,
): PatientSelectorNavigationResult {
	const decision = resolveAuthenticatedEntry(state);
	if (decision !== "open") {
		return navigateToAuthenticatedPage(
			"/pages/patient-select/patient-select",
			state,
		);
	}
	if (isPatientSyncInFlight()) {
		wx.showToast({ title: "就诊人正在同步，请稍后", icon: "none" });
		return "sync-in-flight";
	}
	wx.navigateTo({ url: "/pages/patient-select/patient-select" });
	return "navigated";
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
	patient: Pick<Patient, "id" | "clinicalAccess"> | null,
): void {
	const sessionDecision = resolveAuthenticatedEntry(state);
	if (sessionDecision !== "open") {
		navigateToAuthenticatedPage(url, state);
		return;
	}
	const decision = resolvePatientScopedEntry(
		true,
		hasCurrentPatientContext(patient),
	);
	if (decision === "select-patient") {
		navigateToPatientSelector(state);
		return;
	}
	wx.navigateTo({ url });
}
