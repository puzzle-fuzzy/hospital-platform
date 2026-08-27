/**
 * 小程序 App 容器的最小运行时桥。
 *
 * `app.ts` 会被单独打成 IIFE，而页面服务会由微信按 CommonJS 模块加载；
 * 两个 bundle 的模块变量不是同一份。更重要的是，微信执行 `onLaunch` 时
 * 不能把 `getApp()` 已经完成注册当成前提。这里让 App 入口先登记自己的
 * `globalData`，启动阶段的 API、会话和资料服务可以安全读取同一个对象；
 * 页面运行后仍优先使用微信返回的真实 App 实例。
 *
 * 这个桥只保存 App 容器引用，不保存 token、openid、患者或 provider 数据。
 */

export type MiniProgramAppContainer = {
	globalData?: object;
};

/** App IIFE 启动阶段登记的容器；页面 bundle 会优先通过 getApp() 取实例。 */
let bootstrapApp: MiniProgramAppContainer | null = null;

/**
 * 在调用 `App()` 前登记启动容器。
 *
 * `app.ts` 传入的对象必须和 `App({ globalData })` 使用同一个 globalData
 * 引用，不能复制一份“看起来相同”的状态，否则启动时写入的会话不会被
 * 微信页面后续读取到。校验失败直接抛出配置错误，避免静默创建第二份状态。
 */
export function registerBootstrapApp(app: MiniProgramAppContainer): void {
	if (!app || typeof app !== "object" || !app.globalData) {
		throw new Error("Mini program App globalData is not initialized");
	}
	bootstrapApp = app;
}

/**
 * 取得当前 App 容器。
 *
 * 页面已进入正常运行阶段时，`getApp()` 是权威实例；只有它尚未注册、
 * 被开发者工具热重载暂时清空或测试替身不完整时，才回退到启动桥。所有
 * 读取都包在 try/catch 内，因为不同微信基础库对启动窗口的异常表现并不
 * 完全一致，业务层不应因读取全局状态再次遮蔽真实网络错误。
 */
export function getRegisteredApp<
	TApp extends MiniProgramAppContainer = MiniProgramAppContainer,
>(): TApp | null {
	try {
		if (typeof getApp === "function") {
			const currentApp = getApp() as unknown as TApp;
			if (currentApp?.globalData) return currentApp;
		}
	} catch {
		// App 尚未被微信注册或测试环境未提供完整 getApp 时使用启动桥。
	}
	return bootstrapApp as TApp | null;
}
