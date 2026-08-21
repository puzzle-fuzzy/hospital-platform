import { ApiError } from "./api-client";
import { isCurrentSessionGeneration } from "./session-generation";

/**
 * 页面组合读取使用的会话代际门禁。
 *
 * 单个 API 请求可以在响应层丢弃旧 token 的结果，但一个患者范围页面
 * 通常会连续读取 `/me`、患者目录和业务列表。只要这些请求之间发生了
 * 会话轮换，就不能把每个请求各自合法的结果拼成一个跨账号快照。这里
 * 统一抛出稳定的 `session-changed`，页面再清理展示并要求重新加载。
 * 代际号只存在内存中，不包含 token、openid 或患者标识。
 */
export function assertSessionGeneration(
	expectedGeneration: number,
	context: string,
): void {
	if (isCurrentSessionGeneration(expectedGeneration)) return;
	throw new ApiError(context, { code: "session-changed" });
}
