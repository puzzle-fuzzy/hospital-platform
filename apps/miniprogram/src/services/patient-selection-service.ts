import type { Patient } from "../types";
import { ApiError, safeApiErrorMessage } from "./api-client";

/**
 * 当前就诊人的本地选择状态。
 *
 * 这里只保存平台返回的 opaque patientId，不保存姓名、身份证号、医保号等
 * 医疗隐私字段；患者详情始终以服务端最新目录为准，避免本地缓存过期数据。
 */
export const SELECTED_PATIENT_ID_KEY = "selected_patient_id";

/**
 * 患者范围业务页共用的上下文错误文案。
 *
 * 这些错误不是某一个页面的展示细节，而是“当前患者能否代表后续医疗查询”
 * 的业务状态：stale 不能静默换人，未绑定不能伪造空列表，临床映射不可用时
 * 不能把目录资料当作可查询患者。集中维护后，预约、报告和费用页不会因为
 * 各自新增分支而出现互相矛盾的提示；领域服务未配置的文案仍由页面保留。
 */
const PATIENT_CONTEXT_ERROR_MESSAGES: Readonly<Record<string, string>> =
	Object.freeze({
		"patient-selection-required": "请先登录并选择就诊人",
		"patient-selection-stale": "上次选择的就诊人已失效，请重新选择",
		"patient-not-bound": "当前微信账号暂无绑定的就诊人",
		"patient-clinical-unavailable":
			"该就诊人暂未完成医院档案映射，请选择其他就诊人或刷新",
	});

/**
 * 将患者上下文错误翻译为一致的安全文案。
 *
 * 页面仍可在调用本函数前处理自己的领域错误（例如报告服务未配置），但
 * 一旦进入患者状态分支，必须使用本函数，不能把 ApiError.message 或 Provider
 * 原文直接展示给患者。
 */
export function patientContextErrorMessage(
	error: unknown,
	fallback: string,
): string {
	if (error instanceof ApiError) {
		return (
			PATIENT_CONTEXT_ERROR_MESSAGES[error.code] ??
			safeApiErrorMessage(error, fallback)
		);
	}
	return safeApiErrorMessage(error, fallback);
}

/**
 * 服务端目录与本地选择合并后的结果。
 *
 * `defaulted` 只允许发生在本地从未保存过选择的首次进入场景；如果已有选择
 * 但该患者不再出现在当前 owner 的目录中，必须返回 `stale`，不能偷偷切换到
 * 列表第一位。目录资料存在但没有临床映射时返回 `unavailable`，也不能被
 * 当作一个可查询的患者，避免报告、挂号记录和费用查询落到错误患者身上。
 */
export type PatientSelectionResolution =
	| { state: "empty"; patient?: undefined }
	| { state: "defaulted" | "selected"; patient: Patient }
	| { state: "stale"; patient?: undefined; storedPatientId: string }
	| { state: "unavailable"; patient?: undefined; storedPatientId?: string };

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
	if (resolution.state === "stale") {
		throw new ApiError("Stored patient selection is stale", {
			code: "patient-selection-stale",
		});
	}
	if (resolution.state === "unavailable") {
		throw new ApiError("Patient clinical mapping is unavailable", {
			code: "patient-clinical-unavailable",
		});
	}
	if (resolution.patient) return resolution.patient;
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
 * 传入空的 `storedPatientId` 表示用户尚未做过选择，此时沿用现有产品体验，
 * 但只默认选中第一位已完成临床映射的患者；传入一个当前目录不存在的 ID
 * 或没有临床映射的 ID 都保持未选中，要求用户通过选择页显式确认新的患者。
 */
export function resolvePatientSelection(
	patients: readonly Patient[],
	storedPatientId: string,
): PatientSelectionResolution {
	if (patients.length === 0) return { state: "empty" };

	if (!storedPatientId) {
		// 目录里可能同时存在旧端迁移记录和已经完成 HIS 映射的患者；默认值
		// 只能从可用于临床只读业务的记录中产生，不能把“能展示”当成“能查询”。
		const firstAvailablePatient = patients.find(
			(patient) => patient.clinicalAccess === "ready",
		);
		return firstAvailablePatient
			? { state: "defaulted", patient: firstAvailablePatient }
			: { state: "unavailable" };
	}

	const selectedPatient = patients.find(
		(patient) => patient.id === storedPatientId,
	);
	if (!selectedPatient) return { state: "stale", storedPatientId };
	if (selectedPatient.clinicalAccess !== "ready") {
		// 已有选择但当前映射不可用时不能静默切换到另一位患者，必须由用户
		// 在选择页明确点击一位 ready 患者，避免业务事实落到错误的人身上。
		return { state: "unavailable", storedPatientId };
	}
	return { state: "selected", patient: selectedPatient };
}

/**
 * 读取并应用当前设备的选择状态。
 *
 * 只有“从未选择过”的默认分支会写入第一位可用患者；`stale` 和 `unavailable`
 * 分支都保留原缓存，直到用户在选择页主动点击新的患者，从而让页面无法绕过
 * 显式确认。
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
 * 该函数保留首次进入时的“默认第一位可用患者”体验，但会把 stale、
 * unavailable 和 empty 直接转成稳定错误码；调用方不再自行读取 `.patient`
 * 后丢失目录状态原因。
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
