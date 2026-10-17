/**
 * 医保授权跳转的非敏感业务配置。
 *
 * 机构应用 ID 与渠道凭证只从本机正式材料集合在构建阶段成对注入，
 * 防止正式认证码与历史测试应用 ID 混用；页面状态和平台 API 不保存该凭证。
 */
export const MEDICAL_INSURANCE_CONFIG = {
	medicalAppId: "wxe183cd55df4b4369",
	medicalEnvVersion: "release" as const,
	medicalBizType: "04107",
	medicalCityCode: "140500",
	medicalChannel: "AAG9GbS6mPa4tT_ldqyvQIY_",
	medicalSourceApp: "wx4bc833cb3358c8d8",
	medicalOrgAppId: "__MINIPROGRAM_MEDICAL_ORG_APP_ID__",
	medicalOrgCode: "H14058101270",
	medicalOrgChannelCredential: "__MINIPROGRAM_MEDICAL_ORG_CHANNEL_CREDENTIAL__",
	insurancePollDelaysMs: [1_500, 3_000, 5_000, 8_000] as const,
} as const;
