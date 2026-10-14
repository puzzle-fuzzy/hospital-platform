const BUSINESS_CONTEXT = /预约|取消|挂号|门诊|窗口/;
const INTERNAL_DETAILS =
	/\b(?:sql|sqlstate|exception|stack|traceback|requestId|traceId|patId|patientId|appointmentInfoId|hisRegisterId|registerId|ECONNREFUSED|ETIMEDOUT|ENOTFOUND|EAI_AGAIN|ECONNRESET|database|jdbc|postgres(?:ql)?|mysql|redis)\b|\b(?:connection\s+(?:refused|reset|timeout|timed?\s*out|error|failed)|db\s*(?:connection|connect|连接))|数据库|连接(?:被拒绝|错误|失败|超时)|(?:\d{1,3}\.){3}\d{1,3}|https?:\/\/|(?:select|insert|update|delete)\s+.+\s+(?:from|into|set)\b|\bat\s+\S+\s*\(/i;
const SENSITIVE_DETAILS =
	/身份证|证件(?:号|号码)|手机号|手机号码|联系电话|患者姓名|病人姓名|卡号|患者编号|病人编号|密钥|口令|密码|令牌|\b(?:patientName|patName|cardNo|idCardNo|idNo|certNo|mobile|telephone|phone|token|secret|password|authorization|bearer|openid|unionid|api[-_]?key|private[-_]?key|session[-_]?key)\b/i;
const OPAQUE_VALUE = /\d{8,}|[A-Za-z0-9_+/=-]{32,}/;
const MARKUP = /[<>{}[\]]|&(?:lt|gt|#\d+|#x[\da-f]+);/i;

/** 只允许简短、无患者信息或内部诊断数据的 HIS 取消预约业务提示。 */
export function normalizeAppointmentCancellationMessage(
	value: unknown,
): string | undefined {
	if (typeof value !== "string") return undefined;
	const message = value.trim();
	if (!message || message.length > 160) return undefined;
	for (const character of value) {
		const code = character.codePointAt(0) ?? 0;
		if (
			code <= 0x1f ||
			(code >= 0x7f && code <= 0x9f) ||
			code === 0xad ||
			code === 0x34f ||
			code === 0x61c ||
			code === 0x180e ||
			(code >= 0x200b && code <= 0x200f) ||
			(code >= 0x2028 && code <= 0x202e) ||
			(code >= 0x2060 && code <= 0x2069) ||
			code === 0xfeff
		)
			return undefined;
	}
	if (
		!BUSINESS_CONTEXT.test(message) ||
		INTERNAL_DETAILS.test(message) ||
		SENSITIVE_DETAILS.test(message) ||
		OPAQUE_VALUE.test(message) ||
		MARKUP.test(message)
	)
		return undefined;
	return message;
}
