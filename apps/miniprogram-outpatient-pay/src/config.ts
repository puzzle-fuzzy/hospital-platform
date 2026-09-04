/**
 * 门诊缴费示例的真实平台地址。
 * 小程序只访问新版平台 API，不直连医院或众阳服务。
 */
export const OUTPATIENT_PAY_CONFIG = {
	apiBaseUrl: "https://test-hp.meiyi.pro/api/v2",
	/** 本测试端只承载门诊费用入口；正式订单事实对应 DiagPay。 */
	businessType: "outpatient",
	orderType: "DiagPay",
	requestTimeoutMs: 20_000,
} as const;

/** 与 miniprogram-pay 隔离，避免两个小程序共用旧会话或草稿。 */
export const STORAGE_KEYS = {
	accessToken: "miniprogram-outpatient-pay.access-token",
	userInfo: "miniprogram-outpatient-pay.user-info",
} as const;
