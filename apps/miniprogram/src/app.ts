/**
 * App 入口会被微信直接当作全局脚本执行，不能因为仅导出类型而被 TypeScript
 * 包装成 CommonJS 模块；否则开发者工具的 appService 环境没有 `define/exports`
 * 运行时，首页也就不会完成注册。这个类型只服务于本文件，因此不需要导出。
 */
type AppGlobalData = {
	// 线上小程序固定访问已备案的 HTTPS 域名，真实业务路由由 apiPrefix 隔离。
	apiBaseUrl: string;
	apiPrefix: "/api/v2" | "/api/v1";
	accessToken: string;
	sessionStatus: "signed_out" | "signed_in";
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
	},

	onLaunch() {
		console.info(
			"[医院小程序] 运行包来源：共享 custom-tab-bar；revision=",
			MINI_PROGRAM_BUILD_REVISION,
		);
		// App 入口不能把本地缓存直接当成已登录事实：缓存可能来自旧版本、
		// 开发者工具手工写入或异常中断，也没有经过当前服务端的 owner 验证。
		// token 保留在 storage，由 api-client/session-service 在真正请求前按同一
		// contract 校验；只有 `/me` 或微信 code 兑换成功后，才能写入全局状态。
		// 这样全局 `signed_in` 不会先于服务端会话证明出现，页面也不会在恢复
		// 期间把上一账号的患者上下文误当成当前账号事实。
	},
});
