declare const MINIPROGRAM_PAY_MEDICAL_ORG_CHANNEL_CREDENTIAL: string;

/**
 * 真实测试环境配置。
 *
 * 这里放测试地址和业务参数。医保机构渠道凭证只允许作为本机联调配置，
 * 不要提交到仓库；微信支付商户证书仍由 test-hp 持有。
 */
export const PAY_CONFIG = {
	providerBaseUrl: "https://gpsrmyy.meiyi.pro",
	platformBaseUrl: "https://test-hp.meiyi.pro/api/v1",
	requestChannel: "4",
	appointmentRequestChannel: "my",
	registrationSource: 15,
	settleWay: 6,
	tradeTypeCode: "10",
	authSysCode: "thirdSelfMachine",
	appCode: "WeChatSmallProg",
	sceneCode: "WeChatSmallProgram",
	hospitalId: "10389001",
	medicalOrgCode: "H14058101270",
	medicalInsutype: "310",
	medicalInsuCode: "140581",
	medicalAppId: "wxe183cd55df4b4369",
	medicalEnvVersion: "trial",
	medicalBizType: "04107",
	medicalCityCode: "140500",
	medicalChannel: "AAG9GbS6mPa4tT_ldqyvQIY_",
	medicalSourceApp: "wx4bc833cb3358c8d8",
	medicalOrgAppId: "1JRP6UK6P1AO4460C80A00008AF003C5",
	/** 由本机医保联调材料在 build 时注入，不写入公共配置。 */
	medicalOrgChannelCredential:
		MINIPROGRAM_PAY_MEDICAL_ORG_CHANNEL_CREDENTIAL || "",
	pluginPayType: "CREDIT",
	pluginWorkStationId: "",
	/** 医院接口中的正式门诊名；业务上对应“内科风湿”。 */
	departmentName: "风湿免疫门诊",
	shiftName: "上午",
	/** 测试哪一天就改这一行；页面不会让用户绕回完整挂号流程。 */
	targetDate: "2026-09-04",
	/** 留空时自动取该日期上午第一个可用号源；填写后固定命中 sourceId。 */
	targetSourceId: "",
	/** 留空时自动取第一个可用序号。 */
	targetSerialNumber: "",
	requestTimeoutMs: 20_000,
	insurancePollDelaysMs: [1_500, 3_000, 5_000, 8_000],
} as const;

export const STORAGE_KEYS = {
	accessToken: "miniprogram-pay.access-token",
	userInfo: "miniprogram-pay.user-info",
	pendingPayment: "miniprogram-pay.pending-payment",
	lastResult: "miniprogram-pay.last-result",
} as const;
