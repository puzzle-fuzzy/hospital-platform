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

/**
 * 四个主入口只能由微信 tabBar 切换。
 *
 * 这组路径必须与 `app.json.tabBar.list` 保持一一对应：主 Tab 如果误用
 * `navigateTo`，微信会把它当作普通页面压入页面栈，表现为共享底栏重新创建、
 * 切换时闪动以及 selected 状态丢失。普通业务页仍然保留 navigateTo，
 * 因此这里集中做一次路由边界判断，避免后续页面复制错误写法。
 */
export const PRIMARY_TAB_PAGE_PATHS = Object.freeze([
	"/pages/index/index",
	"/pages/consult/consult",
	"/pages/hospital/hospital",
	"/pages/my/my",
] as const);

type PrimaryTabPagePath = (typeof PRIMARY_TAB_PAGE_PATHS)[number];

function isPrimaryTabPagePath(url: string): url is PrimaryTabPagePath {
	return (PRIMARY_TAB_PAGE_PATHS as readonly string[]).includes(url);
}

/**
 * 判断目标是否已经是当前正在展示的共享主 Tab。
 *
 * 微信官方 custom-tab-bar 会维护四项共享底栏，但业务代码在会话失效、登录恢复
 * 和快捷入口中仍可能重复调用 `switchTab`。对当前页再次 switchTab 会让
 * 页面重新触发生命周期，在低端真机上表现为内容和底栏同时闪一下；它也
 * 没有任何业务收益。因此这里只在确实需要跨 Tab 切换时调用微信 API。
 * 测试环境没有微信全局 `getCurrentPages` 时按“未知”处理，不能因为测试
 * 替身缺少页面栈而错误跳过真实导航。
 */
function isCurrentPrimaryTab(url: string): boolean {
	if (typeof getCurrentPages !== "function") return false;
	const pages = getCurrentPages();
	const currentPage = pages[pages.length - 1] as { route?: string } | undefined;
	const targetRoute = url.startsWith("/") ? url.slice(1) : url;
	return currentPage?.route === targetRoute;
}

/**
 * 主 Tab 的唯一程序化入口。
 *
 * 当前四个主 Tab 主要由微信官方共享底栏直接触发；保留这个小函数是为了
 * 约束快捷入口、登录恢复或深链回跳。只要目标是主 Tab，就必须走
 * `switchTab`，绝不能退化成普通页面导航；底栏的激活图标由微信根据
 * `app.json.tabBar.list[].selectedIconPath` 统一维护。
 */
export function switchToPrimaryTab(url: string): boolean {
	if (!isPrimaryTabPagePath(url)) return false;
	if (isCurrentPrimaryTab(url)) return true;
	wx.switchTab({ url });
	return true;
}

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
 * 未登录必须回到首页建立平台会话；已登录但没有 ready 患者时，使用这条
 * 门禁的预约记录、报告和费用页面必须进入独立选择页。爽约入口是一个有意
 * 的例外：它从“我的”页只要求已验证会话，缺少患者时由爽约页自己展示稳
 * 定错误态，不能把查询入口自动改造成“选择就诊人”模块。把通用判断集中
 * 在这里，避免普通患者范围页面各自复制条件后出现 401 和错误空态。
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
		// 首页本身就是原生主 Tab；使用 switchTab 可以清理普通页面栈，
		// 但不会像 reLaunch 一样重建整棵小程序页面树，避免底栏出现闪帧
		// 或暂时丢失 selectedIconPath。
		switchToPrimaryTab("/pages/index/index");
		return "redirected-to-login";
	}
	if (switchToPrimaryTab(url)) return "navigated";
	wx.navigateTo({ url });
	return "navigated";
}

/**
 * 打开爽约记录页的专用入口。
 *
 * 爽约记录是一个只读派生页，缺少当前患者时也必须先进入页面展示稳定的
 * 错误/空状态，不能复用 `navigateToPatientScopedPage` 把入口改造成“选择就诊人”。
 * 这样用户点击“爽约记录”时不会偶发落入患者选择页；页面内的“更换就诊人”
 * 仍然保留为用户明确点击后的独立动作。
 */
export function navigateToMissedAppointmentsPage(
	state: AuthenticatedEntryState,
): AuthenticatedNavigationResult {
	return navigateToAuthenticatedPage(
		"/pages/missed-appointments/missed-appointments",
		state,
	);
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
	if (switchToPrimaryTab(url)) return;
	wx.navigateTo({ url });
}
