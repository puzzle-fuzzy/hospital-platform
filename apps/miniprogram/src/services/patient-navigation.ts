import { isPatientSyncInFlight } from "./patient-sync-coordinator";

/** 患者范围页面进入前的三态门禁，页面不能把它们混成一个跳转结果。 */
export type PatientScopedEntryDecision =
	| "redirect-to-login"
	| "select-patient"
	| "open";

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
	hasSession: boolean,
): void {
	if (!hasSession) {
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
 * 仍由进程级同步协调器和服务端幂等租约共同保证。
 */
export function navigateToPatientSelector(hasSession = true): void {
	if (!hasSession) {
		navigateToAuthenticatedPage("/pages/patient-select/patient-select", false);
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
	hasSession: boolean,
	hasPatient: boolean,
): void {
	const decision = resolvePatientScopedEntry(hasSession, hasPatient);
	if (decision === "redirect-to-login") {
		navigateToAuthenticatedPage(url, false);
		return;
	}
	if (decision === "select-patient") {
		navigateToPatientSelector();
		return;
	}
	wx.navigateTo({ url });
}
