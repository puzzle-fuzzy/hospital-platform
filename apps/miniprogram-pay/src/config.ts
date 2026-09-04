declare const MINIPROGRAM_PAY_MEDICAL_ORG_CHANNEL_CREDENTIAL: string;

/**
 * 真实测试环境配置。
 *
 * 这里放测试地址和业务参数。医保机构渠道凭证只允许作为本机联调配置，
 * 不要提交到仓库；微信支付商户证书仍由 test-hp 持有。
 */
export const PAY_CONFIG = {
	/** 新版平台 API；小程序只访问这一地址，不直连医院 provider。 */
	apiBaseUrl: "https://test-hp.meiyi.pro/api/v2",
	medicalAppId: "wxe183cd55df4b4369",
	medicalEnvVersion: "trial",
	medicalBizType: "04107",
	medicalCityCode: "140500",
	medicalChannel: "AAG9GbS6mPa4tT_ldqyvQIY_",
	medicalSourceApp: "wx4bc833cb3358c8d8",
	medicalOrgAppId: "1JRP6UK6P1AO4460C80A00008AF003C5",
	medicalOrgCode: "H14058101270",
	/** 由本机医保联调材料在 build 时注入，不写入公共配置。 */
	medicalOrgChannelCredential:
		MINIPROGRAM_PAY_MEDICAL_ORG_CHANNEL_CREDENTIAL || "",
	/** 固定测试门诊；服务端只会重新确认这个公开目录名称对应的排班。 */
	departmentName: "内科风湿",
	/** Provider 目录中的真实门诊名称；页面业务名称仍保持“内科风湿”。 */
	departmentProviderNames: ["风湿免疫门诊", "风湿免疫科门诊"] as const,
	shiftName: "上午",
	/** 只申请未来日期：优先后天，后天无可约排班时再申请大后天。 */
	targetDateOffsets: [2, 3] as const,
	/** 留空时自动取该日期上午第一个可用分时段。 */
	targetSerialNumber: "",
	requestTimeoutMs: 20_000,
	insurancePollDelaysMs: [1_500, 3_000, 5_000, 8_000],
} as const;

export const STORAGE_KEYS = {
	accessToken: "miniprogram-pay.access-token",
	userInfo: "miniprogram-pay.user-info",
	pendingPayment: "miniprogram-pay.pending-payment.v2",
	lastResult: "miniprogram-pay.last-result",
} as const;
