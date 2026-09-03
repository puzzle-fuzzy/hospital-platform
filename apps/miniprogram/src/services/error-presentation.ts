/**
 * 错误展示组合层：把 ApiError 组合为"哪个部分 + 什么问题 + 怎么办 + 错误码"。
 *
 * 三层文案来源，优先级从高到低：
 * 1. surface 级原因覆盖（同一服务端原因在不同页面的既定文案，如
 *    dependency-not-configured 在报告页与知识页的"正在完善中"变体）；
 * 2. 领域 mapper（挂号记录、便民等已有专门映射的 surface）；
 * 3. `contextualApiErrorMessage` + surface 兜底文案。
 *
 * 文案保持与既有用户可见 copy 一致；本层只追加错误码后缀，不改动措辞。
 * 数字码来自 ApiError（服务端权威或镜像回退）；给维护者的反查入口是
 * `docs/错误码.md` 与遥测事件里的 errorKey/requestId。
 */

import { ApiError, contextualApiErrorMessage } from "./api-client";
import { appointmentRecordsErrorMessage } from "./appointment-record-error";
import {
	CLIENT_ERROR_SURFACE_COPY,
	resolveErrorNumericCode,
	type ClientErrorSurface,
} from "./error-registry";
import { convenienceSurfaceErrorMessage } from "./convenience-surface";

/** surface 级原因覆盖：沿用各页面 showError 的既定文案，不新增措辞。 */
const SURFACE_CAUSE_MESSAGES: Partial<
	Record<ClientErrorSurface, Readonly<Record<string, string>>>
> = Object.freeze({
	knowledge: Object.freeze({
		"dependency-not-configured": "健康内容正在完善中，暂时无法使用",
		"health-knowledge-not-found": "未找到相关健康内容",
	}),
	"report-directory": Object.freeze({
		"dependency-not-configured": "报告服务正在完善中，暂时无法使用",
	}),
	"missed-appointments": Object.freeze({
		"dependency-not-configured": "爽约记录功能正在完善中，暂时无法使用",
	}),
	"outpatient-payment": Object.freeze({
		"dependency-not-configured": "门诊缴费功能正在完善中，暂时无法使用",
	}),
	"appointment-schedule": Object.freeze({
		"dependency-not-configured": "预约服务正在完善中，暂时无法使用",
		"appointment-schedule-reference-expired": "排班信息已更新，请返回重新选择",
	}),
	"timeslot-source": Object.freeze({
		"dependency-not-configured": "预约服务正在完善中，暂时无法使用",
		"appointment-schedule-reference-expired": "排班信息已更新，请返回重新选择",
	}),
	"appointment-directory": Object.freeze({
		"dependency-not-configured": "预约服务正在完善中，暂时无法使用",
	}),
	"patient-select": Object.freeze({
		"dependency-not-configured": "就诊人服务正在完善中，暂时无法使用",
	}),
	index: Object.freeze({
		"dependency-not-configured": "该服务正在完善中，请稍后重试",
	}),
});

function errorMessageForSurface(
	error: unknown,
	surface: ClientErrorSurface,
	fallback: string,
): string {
	const causeOverrides = SURFACE_CAUSE_MESSAGES[surface];
	if (
		error instanceof ApiError &&
		causeOverrides &&
		typeof causeOverrides[error.code] === "string"
	) {
		return causeOverrides[error.code] as string;
	}
	switch (surface) {
		case "appointment-records":
			return appointmentRecordsErrorMessage(error);
		case "convenience":
			return convenienceSurfaceErrorMessage(error);
		default:
			return contextualApiErrorMessage(error, fallback);
	}
}

/** 数字码：优先 ApiError 携带的服务端权威值，异常对象回落 unknown。 */
function numericCodeOf(error: unknown): number {
	if (error instanceof ApiError) return error.numericCode;
	if (typeof error === "object" && error !== null) {
		const code = (error as { code?: unknown }).code;
		if (typeof code === "string" && code) return resolveErrorNumericCode(code);
	}
	return resolveErrorNumericCode(undefined);
}

export type PresentedClientError = Readonly<{
	/** 数字错误码；用户可口头反馈，维护者在 docs/错误码.md 反查。 */
	numeric: number;
	/** 稳定字符串码（grep 源码与日志的关键字）；非 ApiError 时为空。 */
	code: string;
	/** "哪个部分"标题。 */
	title: string;
	/** "什么问题 + 怎么办"文案（不含错误码后缀）。 */
	message: string;
	/** 完整用户可见文本：message + 错误码后缀。 */
	displayText: string;
}>;

/** 组合一个错误的完整用户可见展示。 */
export function presentClientError(
	error: unknown,
	surface: ClientErrorSurface,
): PresentedClientError {
	const copy = CLIENT_ERROR_SURFACE_COPY[surface];
	const message = errorMessageForSurface(error, surface, copy.defaultMessage);
	const numeric = numericCodeOf(error);
	return {
		numeric,
		code: error instanceof ApiError ? error.code : "",
		title: copy.title,
		message,
		displayText: `${message}（错误码 ${numeric}）`,
	};
}

/**
 * 给既有文案追加错误码后缀的最小改造助手。
 *
 * 页面 showError 保持原 mapper 不变，只在写入 `data.error` 前包一层：
 * `errorMessageWithCode(error, existingMapper(error))`。
 */
export function errorMessageWithCode(error: unknown, message: string): string {
	const numeric = numericCodeOf(error);
	return `${message}（错误码 ${numeric}）`;
}
