/** HIS 结算统计来源；与 authSysCode、paySceneCode 及微信 AppID 分开传递。 */
export type HisSettlementSource = Readonly<{
	appCode: string;
	sceneCode:
		| "GZH"
		| "AliSmallProgram"
		| "WeChatSmallProgram"
		| "ThirdPartApp"
		| "selfMachine";
}>;

/** 本次保留既有系统来源编码，微信小程序终端按新增通知枚举传入。 */
export const DEFAULT_HIS_SETTLEMENT_SOURCE = Object.freeze({
	appCode: "WeChatSmallProg",
	sceneCode: "WeChatSmallProgram",
} satisfies HisSettlementSource);
