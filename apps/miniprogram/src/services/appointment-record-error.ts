import { ApiError } from "./api-client";

/**
 * 预约记录页面的稳定用户文案。
 *
 * Provider、网络和持久化错误都只说明“本次挂号记录查询没有完成”，不说明
 * 患者没有选择，也不把服务端的英文错误或“外部服务”拓扑暴露给用户。患者
 * 目录阶段的错误仍由页面调用方使用 patientContextErrorMessage 单独处理，避免
 * 把两个连续读取阶段混成同一种提示。
 */
export function appointmentRecordsErrorMessage(
	error: unknown,
	fallback = "挂号记录暂时无法获取，请稍后再试",
): string {
	if (!(error instanceof ApiError)) return fallback;

	switch (error.code) {
		case "provider-request-rejected":
		case "provider-response-invalid":
		case "provider-temporarily-unavailable":
		case "persistence-temporarily-unavailable":
		case "persistence-invalid":
		case "api-request-failed":
		case "network-failed":
			return fallback;
		case "dependency-not-configured":
			return "挂号记录服务暂时未开放，请稍后再试";
		case "appointment-record-query-invalid":
		case "date-range-invalid":
			return "暂时无法查询挂号记录，请稍后再试";
		case "appointment-record-patient-not-found":
			return "未查询到挂号记录";
		case "unauthorized":
			return "登录已过期，请返回首页重新登录";
		default:
			return fallback;
	}
}
