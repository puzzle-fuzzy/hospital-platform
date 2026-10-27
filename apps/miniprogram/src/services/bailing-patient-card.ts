/**
 * 百灵公众号就诊卡的固定入口，由百灵网页授权识别当前微信用户。
 * 不接收个人 userId、外部 URL 或平台凭证；示例链接中的 userId 不能用于其他患者。
 */
const BAILING_PATIENT_CARD_URL =
	"https://cx.o2o.bailingjk.net/wechat/#/bluser/userCard/index?publicNoCode=gzh-048400_0001";

export function buildBailingPatientCardUrl(): string {
	return `${BAILING_PATIENT_CARD_URL}&_t=${Date.now()}`;
}
