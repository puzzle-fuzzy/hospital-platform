/**
 * “我的快递”页面在物流 contract 到达前的记录区域状态。
 *
 * 旧端的记录数组只是预留结构，并没有真实查询请求；因此这里的
 * `unavailable` 表示“旧端没有物流服务，展示受控关闭态”，不是 Provider
 * 返回了成功的空列表。单独保留 `loading` 和 `error`，避免患者目录读取期间
 * 先绘制空记录插图，或在读取失败时把服务故障伪装成没有记录。
 */
export type PatientExpressRecordState = "loading" | "error" | "unavailable";

/**
 * 将患者上下文读取状态转换成记录区域的唯一渲染状态。
 *
 * loading 优先级最高：一次新的重试开始时，即使旧 error 尚未完成清理，
 * 也必须先展示稳定高度的加载壳。请求完成后，错误才进入 error；只有
 * 患者上下文读取成功且物流能力仍关闭时，才进入 unavailable 关闭态。
 */
export function resolvePatientExpressRecordState(
	loading: boolean,
	error: string,
): PatientExpressRecordState {
	if (loading) return "loading";
	if (error) return "error";
	return "unavailable";
}
