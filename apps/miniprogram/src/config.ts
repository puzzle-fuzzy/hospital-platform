/**
 * 医保授权跳转的非敏感业务配置。
 *
 * 机构渠道凭证只从本机 `.local/medical-insurance/test-environment-key-material.json`
 * 在构建阶段注入；源码、页面状态和平台 API 请求都不保存该凭证。
 */
export const MEDICAL_INSURANCE_CONFIG = {
	medicalAppId: "wxe183cd55df4b4369",
	medicalEnvVersion: "trial" as const,
	medicalBizType: "04107",
	medicalCityCode: "140500",
	medicalChannel: "AAG9GbS6mPa4tT_ldqyvQIY_",
	medicalSourceApp: "wx4bc833cb3358c8d8",
	medicalOrgAppId: "1JRP6UK6P1AO4460C80A00008AF003C5",
	medicalOrgCode: "H14058101270",
	medicalOrgChannelCredential: "__MINIPROGRAM_MEDICAL_ORG_CHANNEL_CREDENTIAL__",
	pendingPaymentMaxAgeMs: 15 * 60 * 1000,
	/** 已经生成服务端订单后保留 7 天恢复窗口，不能因本地 15 分钟过期而丢单。 */
	pendingPaymentRecoveryMaxAgeMs: 7 * 24 * 60 * 60 * 1000,
	insurancePollDelaysMs: [1_500, 3_000, 5_000, 8_000] as const,
} as const;

export const MINIPROGRAM_STORAGE_KEYS = {
	pendingMedicalPayment: "hospital-platform.pending-medical-payment.v1",
	lastMedicalPaymentResult: "hospital-platform.last-medical-payment-result",
} as const;
