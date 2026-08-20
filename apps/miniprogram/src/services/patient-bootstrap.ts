/**
 * 首页登录后患者初始化的收敛结果。
 *
 * “微信会话建立成功”和“当前患者上下文可用”是两个不同阶段：
 * - skipped：本次动作明确由目标页面自行读取患者目录；
 * - succeeded：首页已完成本轮患者目录和临床映射同步；
 * - failed：同步请求失败，页面已经清理展示态；
 * - superseded：请求被新的页面/会话代际淘汰，旧结果没有回写资格。
 */
export type PatientBootstrapResult =
	| "skipped"
	| "succeeded"
	| "failed"
	| "superseded";

/**
 * 首页患者目录读取的生命周期结果。
 *
 * `loaded` 表示本轮请求确实取得并提交了当前页面的目录；`superseded`
 * 表示请求已经被更新的页面读取或生命周期淘汰。后者不是“空目录”，
 * 不能让登录恢复链继续启动患者同步，否则旧链路会把一次取消误当成
 * 成功读取，产生重复 Provider 请求和无意义的同步租约竞争。
 */
export type PatientDirectoryLoadResult = "loaded" | "superseded";

/** 只有当前目录读取真正完成时，后续登录初始化才可以继续同步患者。 */
export function shouldContinueAfterPatientLoad(
	result: PatientDirectoryLoadResult,
): boolean {
	return result === "loaded";
}

/**
 * 判断登录成功后是否可以继续执行用户刚才点击的动作。
 *
 * 患者范围页面必须同时满足“同步成功”和“当前页存在已确认患者”；
 * 预约目录、患者选择页等会自行读取目录的页面可以跳过首页同步，但
 * 任何失败或被淘汰的同步都不能触发“登录完成后的成功回调”。
 */
export function shouldContinueAfterLogin(
	bootstrapResult: PatientBootstrapResult,
	requiresPatient: boolean,
	hasConfirmedPatient: boolean,
): boolean {
	if (bootstrapResult === "failed" || bootstrapResult === "superseded") {
		return false;
	}
	if (bootstrapResult === "skipped") return !requiresPatient;
	return !requiresPatient || hasConfirmedPatient;
}
