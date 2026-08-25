import {
	ensureGlobalUserProfile,
	type GlobalUserProfileState,
} from "./services/global-user-profile";

/**
 * App 入口最终会由构建脚本打包成微信可直接执行的全局脚本。源码可以使用
 * TypeScript import，但运行包不能携带 CommonJS 的 `define/exports/require`
 * 启动壳；build.ts 会对 app.ts 做 IIFE bundle，并对产物继续执行全局脚本门禁。
 */
type AppGlobalData = {
	// 线上小程序固定访问已备案的 HTTPS 域名，真实业务路由由 apiPrefix 隔离。
	apiBaseUrl: string;
	apiPrefix: "/api/v2" | "/api/v1";
	accessToken: string;
	sessionStatus: "signed_out" | "signed_in";
	/** App 与页面模块共享的会话代际，防止跨 bundle 误判合法响应。 */
	sessionGeneration: number;
	/**
	 * App 级个人资料快照由 global-user-profile service 原子替换。
	 * App 入口只声明初始结构，启动时由统一仓库填充服务端资料和本机已授权
	 * 头像昵称；页面不再承担第一次资料读取职责。
	 */
	userProfile: {
		status: "idle" | "loading" | "ready" | "error";
		ownerId: string;
		sessionGeneration: number;
		serverDisplayName: string;
		displayName: string;
		gender: "male" | "female" | "unknown";
		age: number | null;
		email: string | null;
		version: number;
		avatarUrl: string;
		wechatProfileState: "idle" | "loading" | "ready" | "declined";
		wechatProfileHint: string;
		error: string;
	};
	/** App.onLaunch 与页面模块共享的单一资料初始化 Promise。 */
	userProfileBootstrapPromise: Promise<GlobalUserProfileState> | null;
	/** App 与页面 bundle 共享微信资料授权 Promise，避免重复弹窗和并发 PUT。 */
	userProfileConsentPromise: Promise<GlobalUserProfileState> | null;
	/** 资料仓库运行时用于跨 bundle 共享订阅集合。 */
	userProfileListeners?: Set<(state: GlobalUserProfileState) => void>;
	/** token 轮换/失效时通知资料等派生快照清理旧账号数据。 */
	sessionChangedListeners?: Set<() => void>;
};

/**
 * 构建脚本会把这个 40 位占位提交号替换为运行包的真实来源。
 * 真机调试日志因此可以直接区分“当前候选”与开发者工具/手机缓存的旧包，
 * 不需要把患者、会话或 provider 信息写入日志。
 */
const MINI_PROGRAM_BUILD_REVISION = "0000000000000000000000000000000000000000";

/** 原生小程序全局状态只保存平台地址和 opaque 会话，不保存 provider 身份。 */
App<{ globalData: AppGlobalData }>({
	globalData: {
		apiBaseUrl: "https://test-hp.meiyi.pro",
		apiPrefix: "/api/v2",
		accessToken: "",
		sessionStatus: "signed_out",
		sessionGeneration: 0,
		userProfile: {
			status: "idle",
			ownerId: "",
			sessionGeneration: -1,
			serverDisplayName: "微信用户",
			displayName: "微信用户",
			gender: "unknown",
			age: null,
			email: null,
			version: 0,
			avatarUrl: "",
			wechatProfileState: "idle",
			wechatProfileHint: "",
			error: "",
		},
		userProfileBootstrapPromise: null,
		userProfileConsentPromise: null,
		sessionChangedListeners: new Set(),
	},

	onLaunch() {
		console.info(
			"[医院小程序] 运行包来源：微信原生 tabBar；revision=",
			MINI_PROGRAM_BUILD_REVISION,
		);
		// 用户进入小程序后立即启动一次静默会话/资料初始化；页面只等待这
		// 一条 Promise，不再把首页、我的页或资料页的 onLoad 当作初始化入口。
		// 失败会沉淀到全局 error 状态，页面仍可提供明确的重试，不会形成未处理
		// Promise，也不会把错误详情或用户资料写入控制台。
		void ensureGlobalUserProfile().catch((error: unknown) => {
			console.warn(
				"[医院小程序] 全局用户资料初始化未完成，页面保留重试状态；errorType=",
				error instanceof Error ? error.name : "unknown",
			);
		});
		// App 入口不能把本地缓存直接当成已登录事实：缓存可能来自旧版本、
		// 开发者工具手工写入或异常中断，也没有经过当前服务端的 owner 验证。
		// token 保留在 storage，由 api-client/session-service 在真正请求前按同一
		// contract 校验；只有 `/me` 或微信 code 兑换成功后，才能写入全局状态。
		// 这样全局 `signed_in` 不会先于服务端会话证明出现，页面也不会在恢复
		// 期间把上一账号的患者上下文误当成当前账号事实。
	},
});
