import type { Patient } from "../types";
import { ApiError, safeApiErrorMessage } from "./api-client";
import { isBoundedPatientId } from "./patient-identifiers";

// 保留原有导出路径，避免页面和历史测试重新定义患者标识边界。
export {
	isBoundedPatientId,
	MAX_PATIENT_ID_LENGTH,
} from "./patient-identifiers";

/**
 * 当前就诊人的本地选择状态。
 *
 * 这里只保存平台返回的 opaque patientId，不保存姓名、身份证号、医保号等
 * 医疗隐私字段；患者详情始终以服务端最新目录为准，避免本地缓存过期数据。
 */
export const SELECTED_PATIENT_ID_KEY = "selected_patient_id";

/**
 * 仅供损坏缓存进入 `stale` 分支的内部占位值。
 *
 * 它不是服务端 patientId，也不会写回 storage、页面或网络请求；占位值刻意
 * 含有控制字符，因此即使未来调用方忘记区分来源，也会被同一形状校验拒绝。
 */
const CORRUPTED_STORED_PATIENT_ID = "\u0000corrupted-selected-patient-id";

/**
	只有这些错误明确说明“当前业务需要用户重新确认就诊人”。

	网络、Provider、持久化或依赖配置故障不能复用这个集合；它们代表查询
	失败，不代表患者选择失败。页面据此决定是否展示“选择就诊人”动作，避免
	把服务异常误导成用户没有选人。
 */
const PATIENT_SELECTION_ERROR_CODES: ReadonlySet<string> = new Set([
	"patient-selection-required",
	"patient-selection-stale",
	"patient-not-bound",
	"patient-clinical-unavailable",
]);

/**
 * 将患者上下文错误翻译为一致的安全文案。
 *
 * 患者上下文的稳定错误码和中文文案唯一维护在 api-client 的公共错误表中；
 * 本函数作为患者范围页面的语义入口，防止页面直接读取 ApiError.message 或
 * Provider 原文。页面仍可在调用本函数前处理自己的领域错误（例如报告服务
 * 未配置），但一旦进入患者状态分支必须回到这里。
 */
export function patientContextErrorMessage(
	error: unknown,
	fallback: string,
): string {
	return safeApiErrorMessage(error, fallback);
}

/**
 * 翻译直接读取患者目录的页面错误，并保留两个需要额外操作引导的状态。
 *
 * `unauthorized` 要求回首页重新建立平台会话，`dependency-not-configured`
 * 则只能重试，不能误导用户进入选择页；其余患者选择、映射和持久化错误
 * 统一交给公共错误码表，避免采血、快递、订阅等页面各自漏掉新状态。
 */
export function patientScopedErrorMessage(
	error: unknown,
	fallback = "就诊人信息暂时无法获取，请稍后再试",
): string {
	if (error instanceof ApiError && error.code === "unauthorized") {
		return "登录已过期，请返回首页重新登录";
	}
	if (error instanceof ApiError && error.code === "dependency-not-configured") {
		return "就诊人服务暂时不可用，请稍后再试";
	}
	return patientContextErrorMessage(error, fallback);
}

/**
	判断错误是否需要把用户引导到就诊人选择页。

	该判断必须基于平台稳定错误码，而不能根据中文 message、HTTP 状态码或
	Provider 原文猜测。只有患者上下文已经被服务端明确判定为缺失、失效或
	临床不可用时，页面才显示选择动作；其它错误只允许重试。
 */
export function isPatientSelectionError(error: unknown): boolean {
	return (
		error instanceof ApiError && PATIENT_SELECTION_ERROR_CODES.has(error.code)
	);
}

/**
	判断患者范围业务失败后是否必须清空当前患者上下文。

	患者目录已经成功确认后，预约、问诊、病历等下游只读服务仍可能因为
	Provider 超时、依赖未配置或临时 503 失败。这些错误不代表用户没有
	选择就诊人，页面必须保留已确认的患者卡片，避免出现“真实数据闪现后
	消失”的误导。只有会话明确失效、会话代际发生变化，或本地已经没有
	可用会话时，才允许清空患者上下文。
 */
export function shouldClearPatientContextAfterError(
	error: unknown,
	sessionStillPresent: boolean,
): boolean {
	if (!sessionStillPresent) return true;
	return (
		error instanceof ApiError &&
		(error.code === "unauthorized" || error.code === "session-changed")
	);
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
 * 将目录解析状态转换成稳定的患者上下文错误对象。
 *
 * `empty`、`stale` 和 `unavailable` 都不是普通空列表：它们分别表示没有
 * 绑定患者、已保存患者已失效、或医院档案映射未完成。先统一转换成 ApiError，
 * 页面才能复用同一套中文文案和错误码，而不会因页面不同产生漂移。
 */
export function patientSelectionResolutionError(
	resolution: PatientSelectionResolution,
): ApiError | undefined {
	if (resolution.state === "empty") {
		return new ApiError("No patient is bound to the current account", {
			code: "patient-not-bound",
		});
	}
	if (resolution.state === "stale") {
		return new ApiError("Stored patient selection is stale", {
			code: "patient-selection-stale",
		});
	}
	if (resolution.state === "unavailable") {
		return new ApiError("Patient clinical mapping is unavailable", {
			code: "patient-clinical-unavailable",
		});
	}
	return undefined;
}

/** 将目录解析状态直接翻译成页面安全文案；成功状态返回给定空兜底。 */
export function patientSelectionResolutionMessage(
	resolution: PatientSelectionResolution,
	fallback = "",
): string {
	return patientContextErrorMessage(
		patientSelectionResolutionError(resolution),
		fallback,
	);
}

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
	const selectionError = patientSelectionResolutionError(resolution);
	if (selectionError) throw selectionError;
	if (resolution.patient) return resolution.patient;
	// 该分支只用于防御未来新增 resolution 状态；当前 union 的 empty 已在上面处理。
	throw new ApiError("Patient selection resolution is incomplete", {
		code: "patient-selection-required",
	});
}

/** 读取上一次选择的就诊人 ID；非字符串缓存只作为无效值对外隐藏。 */
export function getSelectedPatientId(): string {
	const value = wx.getStorageSync(SELECTED_PATIENT_ID_KEY);
	return typeof value === "string" ? value : "";
}

/**
 * 将微信 storage 原始值转换成患者目录解析器的输入。
 *
 * `undefined`/空字符串表示没有历史选择；`null` 或其它非字符串则表示缓存已经
 * 损坏，必须进入 `stale` 而不能伪装成首次进入，否则目录同步后会静默默认
 * 第一位患者。占位值不会离开本服务，也不会成为实际业务 patientId。
 */
export function normalizeStoredPatientIdForResolution(value: unknown): string {
	if (typeof value === "string") return value;
	if (value === undefined) return "";
	return CORRUPTED_STORED_PATIENT_ID;
}

/**
 * 判断异步结果是否仍属于设备当前明确选择的患者。
 *
 * 页面请求可能在用户进入选择页期间继续完成；仅依赖页面实例请求 token
 * 不能识别“另一个页面已经换人”的情况。调用方应在发起患者范围请求前和
 * 响应落地前都调用本函数，旧患者响应就会被安全丢弃，不会短暂覆盖新患者
 * 的页面状态。第二个参数只为纯单元测试提供显式快照，生产调用默认读取
 * 本地 opaque patientId。
 */
export function isCurrentSelectedPatient(
	patientId: string,
	storedPatientId = getSelectedPatientId(),
): boolean {
	return (
		isBoundedPatientId(patientId) &&
		isBoundedPatientId(storedPatientId) &&
		patientId === storedPatientId
	);
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
	if (patients.length === 0) {
		// 空目录的含义取决于本地是否已有明确选择：首次进入时它表示当前
		// owner 没有任何患者；但如果本地曾保存过 patientId，则说明该患者
		// 已经不在最新 owner-scoped 快照中。两种情况都不能切到其他患者，
		// 后者必须保留 stale 语义，让页面要求用户显式重新选择，也避免把
		// “目录暂时为空/患者已失效”误报成“从未绑定患者”。
		return storedPatientId
			? { state: "stale", storedPatientId }
			: { state: "empty" };
	}

	if (!storedPatientId) {
		// 目录里可能同时存在旧端迁移记录和已经完成 HIS 映射的患者；默认值
		// 只能从可用于临床只读业务的记录中产生，不能把“能展示”当成“能查询”。
		const firstAvailablePatient = patients.find(
			(patient) =>
				patient.clinicalAccess === "ready" && isBoundedPatientId(patient.id),
		);
		return firstAvailablePatient
			? { state: "defaulted", patient: firstAvailablePatient }
			: { state: "unavailable" };
	}

	const selectedPatient = patients.find(
		(patient) =>
			patient.id === storedPatientId && isBoundedPatientId(patient.id),
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
	const resolution = resolvePatientSelection(
		patients,
		normalizeStoredPatientIdForResolution(
			wx.getStorageSync(SELECTED_PATIENT_ID_KEY),
		),
	);
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
	if (isBoundedPatientId(patientId)) {
		wx.setStorageSync(SELECTED_PATIENT_ID_KEY, patientId);
		return;
	}
	if (patientId === "") {
		// 空值表示明确清除；其它非法值不能覆盖一个仍可能有效的选择，避免
		// 页面事件或损坏的服务端读模型把坏字符串持久化成当前患者。
		wx.removeStorageSync(SELECTED_PATIENT_ID_KEY);
	}
}

/** 清理当前就诊人选择，供退出登录、会话失效和明确清除上下文流程复用。 */
export function clearSelectedPatientId(): void {
	setSelectedPatientId("");
}
