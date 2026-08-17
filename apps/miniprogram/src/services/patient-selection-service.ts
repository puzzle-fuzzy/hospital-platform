import type { Patient } from "../types";
import { ApiError } from "./api-client";

/**
 * 当前就诊人的本地选择状态。
 *
 * 这里只保存平台返回的 opaque patientId，不保存姓名、身份证号、医保号等
 * 医疗隐私字段；患者详情始终以服务端最新目录为准，避免本地缓存过期数据。
 */
export const SELECTED_PATIENT_ID_KEY = "selected_patient_id";

/**
 * 服务端目录与本地选择合并后的结果。
 *
 * `defaulted` 只允许发生在本地从未保存过选择的首次进入场景；如果已有选择
 * 但该患者不再出现在当前 owner 的目录中，必须返回 `stale`，不能偷偷切换到
 * 列表第一位，避免报告、挂号记录和费用查询落到错误患者身上。
 */
export type PatientSelectionResolution =
	| { state: "empty"; patient?: undefined }
	| { state: "defaulted" | "selected"; patient: Patient }
	| { state: "stale"; patient?: undefined; storedPatientId: string };

/**
 * 将目录解析结果提升为业务页面可消费的“必须有患者”结果。
 *
 * 页面不能把 `empty`、`stale` 和“调用方没有传患者”混成同一个错误：
 * `empty` 是服务端确认当前 owner 没有目录患者，`stale` 则表示本地曾经
 * 明确选择过的患者已经不在当前目录。后者必须要求用户重新选择，不能
 * 静默回退到第一位患者，否则报告、挂号和费用可能落到错误的人身上。
 */
export function requirePatientFromResolution(
	resolution: PatientSelectionResolution,
): Patient {
	if (resolution.patient) return resolution.patient;
	if (resolution.state === "stale") {
		throw new ApiError("Stored patient selection is stale", {
			code: "patient-selection-stale",
		});
	}
	throw new ApiError("No patient is bound to the current account", {
		code: "patient-not-bound",
	});
}

/** 读取上一次选择的就诊人 ID；缓存损坏时按未选择处理。 */
export function getSelectedPatientId(): string {
	const value = wx.getStorageSync(SELECTED_PATIENT_ID_KEY);
	return typeof value === "string" ? value : "";
}

/**
 * 纯函数解析患者目录与已保存选择，供业务页面和测试共用。
 *
 * 传入空的 `storedPatientId` 表示用户尚未做过选择，此时沿用现有产品体验
 * 默认选中目录第一项；传入一个当前目录不存在的 ID 则保持未选中，要求用户
 * 通过选择页显式确认新的患者。
 */
export function resolvePatientSelection(
	patients: readonly Patient[],
	storedPatientId: string,
): PatientSelectionResolution {
	if (patients.length === 0) return { state: "empty" };

	if (!storedPatientId) {
		const firstPatient = patients[0];
		return firstPatient
			? { state: "defaulted", patient: firstPatient }
			: { state: "empty" };
	}

	const selectedPatient = patients.find(
		(patient) => patient.id === storedPatientId,
	);
	return selectedPatient
		? { state: "selected", patient: selectedPatient }
		: { state: "stale", storedPatientId };
}

/**
 * 读取并应用当前设备的选择状态。
 *
 * 只有“从未选择过”的默认分支会写入第一位患者；`stale` 分支保留原缓存，
 * 直到用户在选择页主动点击新的患者，从而让页面无法绕过显式确认。
 */
export function resolveStoredPatientSelection(
	patients: readonly Patient[],
): PatientSelectionResolution {
	const resolution = resolvePatientSelection(patients, getSelectedPatientId());
	if (resolution.state === "defaulted") {
		setSelectedPatientId(resolution.patient.id);
	}
	return resolution;
}

/**
 * 业务页面统一取得当前患者。
 *
 * 该函数保留首次进入时的“默认第一位”体验，但会把 stale/empty 直接
 * 转成稳定错误码；调用方不再自行读取 `.patient` 后丢失目录状态原因。
 */
export function requireStoredPatientSelection(
	patients: readonly Patient[],
): Patient {
	return requirePatientFromResolution(resolveStoredPatientSelection(patients));
}

/**
 * 持久化当前就诊人 ID。
 * 空值会清理明确要求清除的选择；目录发现旧 ID 失效时不会自动写入新患者，
 * 由选择页的显式点击完成替换，避免把失效状态伪装成另一位患者。
 */
export function setSelectedPatientId(patientId: string): void {
	if (patientId) {
		wx.setStorageSync(SELECTED_PATIENT_ID_KEY, patientId);
		return;
	}
	wx.removeStorageSync(SELECTED_PATIENT_ID_KEY);
}

/** 清理当前就诊人选择，供退出登录、会话失效和明确清除上下文流程复用。 */
export function clearSelectedPatientId(): void {
	setSelectedPatientId("");
}
