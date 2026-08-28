import { expect, test } from "bun:test";
import type { Patient } from "../types";
import { ApiError } from "./api-client";
import {
	isBoundedPatientId,
	isCurrentSelectedPatient,
	isPatientSelectionError,
	normalizeStoredPatientIdForResolution,
	patientContextErrorMessage,
	patientScopedErrorMessage,
	patientSelectionResolutionError,
	patientSelectionResolutionMessage,
	preservedPatientForReload,
	requirePatientFromResolution,
	resolvePatientSelection,
	shouldClearPatientContextAfterError,
} from "./patient-selection-service";

function patient(id: string): Patient {
	return {
		id,
		displayName: `患者-${id}`,
		relationship: "self",
		cardNumberMasked: "********1234",
		source: "hospital-his",
		clinicalAccess: "ready",
	};
}

function unavailablePatient(id: string): Patient {
	return {
		...patient(id),
		clinicalAccess: "unavailable",
	};
}

function thrownApiErrorCode(action: () => unknown): string {
	try {
		action();
	} catch (error) {
		if (error instanceof ApiError) return error.code;
		throw error;
	}
	throw new Error("Expected the action to throw an ApiError");
}

test("首次进入选择页时才允许默认目录第一位患者", () => {
	const result = resolvePatientSelection(
		[patient("patient-a"), patient("patient-b")],
		"",
	);

	expect(result).toEqual({
		state: "defaulted",
		patient: patient("patient-a"),
	});
});

test("首次进入选择页时跳过仅可展示的旧患者", () => {
	const result = resolvePatientSelection(
		[unavailablePatient("legacy-patient"), patient("patient-ready")],
		"",
	);

	expect(result).toEqual({
		state: "defaulted",
		patient: patient("patient-ready"),
	});
});

test("首次进入选择页时跳过 patientId 形状异常的可用患者", () => {
	const result = resolvePatientSelection(
		[patient(" "), patient("patient-ready")],
		"",
	);

	expect(result).toEqual({
		state: "defaulted",
		patient: patient("patient-ready"),
	});
});

test("没有任何临床映射时不能默认选中目录患者", () => {
	const result = resolvePatientSelection(
		[unavailablePatient("legacy-patient")],
		"",
	);

	expect(result).toEqual({ state: "unavailable" });
});

test("已有选择从目录消失时必须进入 stale，不能静默切换到第一位", () => {
	const result = resolvePatientSelection(
		[patient("patient-a"), patient("patient-c")],
		"patient-b",
	);

	// 这是患者安全边界：不能因为 provider 暂时少返回一人，
	// 就把报告、挂号记录或费用查询切到另一个患者。
	expect(result).toEqual({
		state: "stale",
		storedPatientId: "patient-b",
	});
});

test("已有选择但最新目录为空时仍必须进入 stale", () => {
	const result = resolvePatientSelection([], "patient-removed");

	// 空快照也代表“当前选择不再被 owner 目录确认”；不能因为没有第二条
	// 患者可供切换，就把失效选择降级成未绑定，避免页面隐藏真正的失效原因。
	expect(result).toEqual({
		state: "stale",
		storedPatientId: "patient-removed",
	});
});

test("已保存的患者仍在当前 owner 目录时保持显式选择", () => {
	const result = resolvePatientSelection(
		[patient("patient-a"), patient("patient-b")],
		"patient-b",
	);

	expect(result).toEqual({
		state: "selected",
		patient: patient("patient-b"),
	});
});

test("已保存患者临床映射失效时不能静默切换患者", () => {
	const result = resolvePatientSelection(
		[unavailablePatient("patient-b"), patient("patient-ready")],
		"patient-b",
	);

	expect(result).toEqual({
		state: "unavailable",
		storedPatientId: "patient-b",
	});
});

test("目录返回与本地缓存一致但形状异常时仍必须进入 stale", () => {
	const result = resolvePatientSelection([patient(" ")], " ");

	// 不能因为字符串恰好相等就把损坏的 opaque ID 当成已授权患者，
	// 否则后续页面可能把未验证的值带入患者范围接口。
	expect(result).toEqual({
		state: "stale",
		storedPatientId: " ",
	});
});

test("业务页面区分没有绑定患者、已失效和临床映射不可用", () => {
	expect(
		thrownApiErrorCode(() => requirePatientFromResolution({ state: "empty" })),
	).toBe("patient-not-bound");
	expect(
		thrownApiErrorCode(() =>
			requirePatientFromResolution({
				state: "stale",
				storedPatientId: "patient-removed",
			}),
		),
	).toBe("patient-selection-stale");
	expect(
		thrownApiErrorCode(() =>
			requirePatientFromResolution({
				state: "unavailable",
				storedPatientId: "legacy-patient",
			}),
		),
	).toBe("patient-clinical-unavailable");
	expect(
		requirePatientFromResolution({
			state: "selected",
			patient: patient("patient-b"),
		}),
	).toEqual(patient("patient-b"));
});

test("所有患者页面复用同一组目录解析错误码和文案", () => {
	const empty = { state: "empty" } as const;
	const stale = { state: "stale", storedPatientId: "patient-removed" } as const;
	const unavailable = {
		state: "unavailable",
		storedPatientId: "patient-legacy",
	} as const;

	expect(patientSelectionResolutionError(empty)?.code).toBe(
		"patient-not-bound",
	);
	expect(patientSelectionResolutionError(stale)?.code).toBe(
		"patient-selection-stale",
	);
	expect(patientSelectionResolutionError(unavailable)?.code).toBe(
		"patient-clinical-unavailable",
	);
	expect(patientSelectionResolutionMessage(empty)).toBe(
		"暂未添加就诊人，请先添加",
	);
	expect(patientSelectionResolutionMessage(stale)).toBe("请选择就诊人后再继续");
	expect(patientSelectionResolutionMessage(unavailable)).toBe(
		"该就诊人暂时无法使用此服务，请更换就诊人",
	);
});

test("患者范围业务页使用统一的上下文错误文案", () => {
	expect(
		patientContextErrorMessage(
			new ApiError("provider detail must not be shown", {
				code: "patient-clinical-unavailable",
			}),
			"备用错误",
		),
	).toBe("该就诊人暂时无法使用此服务，请更换就诊人");
	expect(
		patientContextErrorMessage(
			new ApiError("stale patient", { code: "patient-selection-stale" }),
			"备用错误",
		),
	).toBe("请选择就诊人后再继续");
	expect(
		patientContextErrorMessage(new Error("内部原文不应展示"), "备用错误"),
	).toBe("备用错误");
});

test("直接读取患者目录的页面共享登录、依赖和选择错误边界", () => {
	expect(
		patientScopedErrorMessage(
			new ApiError("expired", { code: "unauthorized" }),
		),
	).toBe("登录已过期，请返回首页重新登录");
	expect(
		patientScopedErrorMessage(
			new ApiError("not configured", { code: "dependency-not-configured" }),
		),
	).toBe("暂时无法获取就诊人，请稍后再试");
	expect(
		patientScopedErrorMessage(
			new ApiError("stale", { code: "patient-selection-stale" }),
		),
	).toBe("请选择就诊人后再继续");
	expect(
		patientScopedErrorMessage(
			new ApiError("storage unavailable", {
				code: "persistence-temporarily-unavailable",
			}),
		),
	).toBe("就诊人信息暂时无法获取，请稍后再试");
});

test("患者选择动作只由明确的患者上下文错误触发", () => {
	for (const code of [
		"patient-selection-required",
		"patient-selection-stale",
		"patient-not-bound",
		"patient-clinical-unavailable",
	]) {
		expect(isPatientSelectionError(new ApiError("内部错误", { code }))).toBe(
			true,
		);
	}

	for (const code of [
		"network-failed",
		"provider-request-rejected",
		"persistence-temporarily-unavailable",
		"dependency-not-configured",
	]) {
		expect(isPatientSelectionError(new ApiError("内部错误", { code }))).toBe(
			false,
		);
	}
	expect(isPatientSelectionError(new Error("网络失败"))).toBe(false);
});

test("下游业务查询失败时保留已确认患者，会话失效时才清空", () => {
	// 预约、问诊和病历记录都是患者目录确认后的下游只读查询；Provider
	// 暂时不可用不等于患者不存在，页面应继续展示当前就诊人。
	expect(
		shouldClearPatientContextAfterError(
			new ApiError("provider unavailable", {
				code: "provider-request-rejected",
			}),
			true,
		),
	).toBe(false);
	expect(
		shouldClearPatientContextAfterError(
			new ApiError("session expired", { code: "unauthorized" }),
			true,
		),
	).toBe(true);
	expect(
		shouldClearPatientContextAfterError(new Error("token cleared"), false),
	).toBe(true);
});

test("页面重载只保留仍与本地明确选择一致的患者卡片", () => {
	const selected = patient("patient-a");

	// 同账号刷新期间允许保留上一份已确认卡片，避免等待 provider 查询时
	// 姓名和卡片高度闪退；这只是视觉上下文，不会绕过后续目录和代际校验。
	expect(preservedPatientForReload(selected, "patient-a")).toEqual(selected);

	// 用户已经在选择页换人，或会话刚重置时，旧卡片必须立即撤掉，不能把
	// A 的身份留在 B 的页面上。非法/空缓存同样不能证明旧患者仍然有效。
	expect(preservedPatientForReload(selected, "patient-b")).toBeNull();
	expect(preservedPatientForReload(selected, "")).toBeNull();
	expect(preservedPatientForReload(null, "patient-a")).toBeNull();
});

test("异步患者结果必须匹配当前显式选择", () => {
	// 页面请求返回时如果本地已经换人，旧 patientId 不能继续写入页面。
	expect(isCurrentSelectedPatient("patient-a", "patient-a")).toBe(true);
	expect(isCurrentSelectedPatient("patient-a", "patient-b")).toBe(false);
	expect(isCurrentSelectedPatient("patient-a", "")).toBe(false);
	expect(isCurrentSelectedPatient(" ", " ")).toBe(false);
	expect(isCurrentSelectedPatient("x".repeat(129), "x".repeat(129))).toBe(
		false,
	);
});

test("患者上下文统一拒绝越界 patientId 形状", () => {
	for (const value of [
		"",
		" ",
		"\tpatient-a",
		"patient-a\n",
		"x".repeat(129),
	]) {
		expect(isBoundedPatientId(value)).toBe(false);
	}
	expect(isBoundedPatientId("patient-a")).toBe(true);
	expect(isBoundedPatientId("x".repeat(128))).toBe(true);
});

test("损坏的 storage 值不能伪装成首次进入并默认切换患者", () => {
	expect(normalizeStoredPatientIdForResolution(undefined)).toBe("");
	expect(normalizeStoredPatientIdForResolution(null)).not.toBe("");
	expect(normalizeStoredPatientIdForResolution(123)).not.toBe("");
	expect(normalizeStoredPatientIdForResolution({ id: "patient-a" })).not.toBe(
		"",
	);

	const corruptedPatientId = normalizeStoredPatientIdForResolution(123);
	expect(isBoundedPatientId(corruptedPatientId)).toBe(false);
	const result = resolvePatientSelection(
		[patient("patient-a")],
		corruptedPatientId,
	);
	expect(result).toEqual({
		state: "stale",
		storedPatientId: corruptedPatientId,
	});
});
