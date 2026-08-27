import { getRegisteredApp } from "./app-runtime-context";

/**
 * 小程序平台会话的进程内代际号。
 *
 * 患者目录、资料和费用请求可能跨越一次微信会话轮换；仅依赖页面实例
 * 或旧 token 是否存在，无法判断一个异步结果是不是属于当前账号。这里不
 * 保存 token，也不参与认证，只在客户端 token 真正变化时递增一个内存代际，
 * 供 single-flight 和页面回写守卫隔离不同账号的异步工作。
 */
let currentSessionGeneration = 0;

type SharedSessionGlobalData = {
	globalData?: {
		/** App bundle 与页面 CommonJS bundle 共用的会话代际。 */
		sessionGeneration?: number;
	};
};

/**
 * App.ts 会被单独打成 IIFE，而页面服务仍由微信按 CommonJS 模块加载；两边
 * 的模块级变量不是同一份。会话代际如果不落到 globalData，App 启动登录后
 * 页面会把合法的资料/患者响应误判成旧会话。测试环境没有 getApp 时继续使用
 * 模块内回退值，真实小程序运行时则以 App.globalData 为唯一共享事实。
 */
function sharedGlobalData(): SharedSessionGlobalData["globalData"] | undefined {
	try {
		return getRegisteredApp<SharedSessionGlobalData>()?.globalData;
	} catch {
		// 页面单元测试和构建期静态分析没有微信 App 容器，使用本地代际即可。
		return undefined;
	}
}

function readSessionGeneration(): number {
	const shared = sharedGlobalData();
	const value = shared?.sessionGeneration;
	if (typeof value === "number" && Number.isSafeInteger(value) && value >= 0) {
		currentSessionGeneration = value;
		return value;
	}
	if (shared) shared.sessionGeneration = currentSessionGeneration;
	return currentSessionGeneration;
}

function writeSessionGeneration(value: number): void {
	currentSessionGeneration = value;
	const shared = sharedGlobalData();
	if (shared) shared.sessionGeneration = value;
}

/** 读取当前会话代际；初始缓存 token 不需要额外递增。 */
export function getSessionGeneration(): number {
	return readSessionGeneration();
}

/** 判断异步结果是否仍属于它发起时记录的会话代际。 */
export function isCurrentSessionGeneration(expected: number): boolean {
	return readSessionGeneration() === expected;
}

/**
 * 在平台 token 发生变化后推进会话代际。
 * 返回值便于测试和调用方记录本轮代际，但不返回任何认证字段。
 */
export function advanceSessionGeneration(): number {
	const nextGeneration = readSessionGeneration() + 1;
	writeSessionGeneration(nextGeneration);
	return nextGeneration;
}
