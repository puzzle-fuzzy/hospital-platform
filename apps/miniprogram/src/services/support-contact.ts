/**
 * 小程序公开客服信息。
 *
 * 这不是密钥，也不是后端运行配置，但仍需要集中维护，避免首页、反馈页
 * 或后续帮助页各自复制一份号码和工作时间。客服负责人确认号码、时段或
 * 变更流程后，只应修改这里并重新构建运行包；本文件不代表“反馈工单”已经
 * 接通，在线反馈仍保持旧端真实行为的提示态。
 */
export const SUPPORT_CONTACT = Object.freeze({
	phone: "13835627395",
	workHours: "工作日：08:00-17:00",
});

/** 反馈页热点问题使用的公开电话，统一从客服配置生成，避免文案漂移。 */
export function getSupportPhoneText(): string {
	return `客服电话：${SUPPORT_CONTACT.phone}`;
}

/** 统一生成客服信息弹窗正文，页面不得自行拼接另一份营业时间。 */
export function getSupportContactModalContent(): string {
	return `${getSupportPhoneText()}\n${SUPPORT_CONTACT.workHours}`;
}
