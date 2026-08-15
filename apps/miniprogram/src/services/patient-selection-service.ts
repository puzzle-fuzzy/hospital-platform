/**
 * 当前就诊人的本地选择状态。
 *
 * 这里只保存平台返回的 opaque patientId，不保存姓名、身份证号、医保号等
 * 医疗隐私字段；患者详情始终以服务端最新目录为准，避免本地缓存过期数据。
 */
export const SELECTED_PATIENT_ID_KEY = "selected_patient_id";

/** 读取上一次选择的就诊人 ID；缓存损坏时按未选择处理。 */
export function getSelectedPatientId(): string {
	const value = wx.getStorageSync(SELECTED_PATIENT_ID_KEY);
	return typeof value === "string" ? value : "";
}

/**
 * 持久化当前就诊人 ID。
 * 空值会清理旧选择，患者退出或目录失效时不会残留错误关联。
 */
export function setSelectedPatientId(patientId: string): void {
	if (patientId) {
		wx.setStorageSync(SELECTED_PATIENT_ID_KEY, patientId);
		return;
	}
	wx.removeStorageSync(SELECTED_PATIENT_ID_KEY);
}

/** 清理当前就诊人选择，供退出登录、会话失效和空目录流程复用。 */
export function clearSelectedPatientId(): void {
	setSelectedPatientId("");
}
