/**
 * 小程序会话凭证变化事件。
 *
 * `api-client.ts` 负责写入/清理 token，用户资料仓库不能反向被它直接
 * import，否则会形成 api-client → global-user-profile → api-client 的循环
 * 依赖。这里提供一个无业务依赖的事件桥：凭证轮换或失效时只发布“会话
 * 已变化”事实，由资料仓库、患者上下文等订阅者各自清理自己的派生快照。
 */
export type SessionChangedListener = () => void;

type SharedAppData = {
	globalData?: {
		/** App IIFE 与页面 CommonJS bundle 共用的监听集合。 */
		sessionChangedListeners?: Set<SessionChangedListener>;
	};
};

/** 没有微信 App 容器时给单元测试和构建期分析使用的本地回退集合。 */
const fallbackListeners = new Set<SessionChangedListener>();

function getSharedListeners(): Set<SessionChangedListener> {
	try {
		if (typeof getApp !== "function") return fallbackListeners;
		const appData = (getApp() as unknown as SharedAppData).globalData;
		if (!appData) return fallbackListeners;
		if (appData.sessionChangedListeners instanceof Set) {
			return appData.sessionChangedListeners;
		}
		const listeners = new Set<SessionChangedListener>();
		appData.sessionChangedListeners = listeners;
		return listeners;
	} catch {
		// 微信容器尚未完成初始化或测试替身不完整时，不阻断认证请求本身。
		return fallbackListeners;
	}
}

/** 注册会话变化监听器；页面/服务卸载时应调用返回的取消函数。 */
export function registerSessionChangedListener(
	listener: SessionChangedListener,
): () => void {
	const listeners = getSharedListeners();
	listeners.add(listener);
	return () => listeners.delete(listener);
}

/**
 * 通知所有会话派生状态清理旧快照。
 *
 * 监听器异常不能阻断 token 清理和后续重新登录；因此每个监听器单独隔离，
 * 并复制一份集合后再遍历，避免监听器在回调中取消订阅导致遍历行为漂移。
 */
export function notifySessionChanged(): void {
	for (const listener of [...getSharedListeners()]) {
		try {
			listener();
		} catch {
			// 派生 UI 状态清理失败不能改变认证层的 fail-closed 结果。
		}
	}
}
