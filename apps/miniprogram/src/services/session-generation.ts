/**
 * 小程序平台会话的进程内代际号。
 *
 * 患者目录、资料和费用请求可能跨越一次微信会话轮换；仅依赖页面实例
 * 或旧 token 是否存在，无法判断一个异步结果是不是属于当前账号。这里不
 * 保存 token，也不参与认证，只在客户端 token 真正变化时递增一个内存代际，
 * 供 single-flight 和页面回写守卫隔离不同账号的异步工作。
 */
let currentSessionGeneration = 0;

/** 读取当前会话代际；初始缓存 token 不需要额外递增。 */
export function getSessionGeneration(): number {
	return currentSessionGeneration;
}

/** 判断异步结果是否仍属于它发起时记录的会话代际。 */
export function isCurrentSessionGeneration(expected: number): boolean {
	return currentSessionGeneration === expected;
}

/**
 * 在平台 token 发生变化后推进会话代际。
 * 返回值便于测试和调用方记录本轮代际，但不返回任何认证字段。
 */
export function advanceSessionGeneration(): number {
	currentSessionGeneration += 1;
	return currentSessionGeneration;
}
