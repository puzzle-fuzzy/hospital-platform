/**
 * 小程序患者范围请求共用的内部 patientId 长度上限。
 *
 * 这是平台 opaque 标识的输入形状约束，不代表 owner、临床映射或业务权限
 * 已经成立；真正的授权仍由服务端按当前会话重新校验。把规则放在独立模块，
 * 让患者选择状态、页面 helper 和底层 api-client 不再各自复制一套边界。
 */
export const MAX_PATIENT_ID_LENGTH = 128;

/**
 * 判断值是否可以作为小程序患者范围 API 的内部标识。
 *
 * 控制字符、首尾空格和超长值会破坏 URL、页面事件或日志关联；这类值必须
 * 在网络请求之前拒绝，不能交给服务端或 Provider 猜测调用方意图。
 */
export function isBoundedPatientId(value: unknown): value is string {
	return (
		typeof value === "string" &&
		value.length > 0 &&
		value.length <= MAX_PATIENT_ID_LENGTH &&
		value === value.trim() &&
		!Array.from(value).some((character) => {
			const code = character.charCodeAt(0);
			return code <= 0x1f || code === 0x7f;
		})
	);
}
