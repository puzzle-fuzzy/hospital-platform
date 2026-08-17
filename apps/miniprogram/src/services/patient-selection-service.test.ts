import { expect, test } from "bun:test";
import type { Patient } from "../types";
import { ApiError } from "./api-client";
import {
	isCurrentSelectedPatient,
	patientContextErrorMessage,
	patientSelectionResolutionError,
	patientSelectionResolutionMessage,
	requirePatientFromResolution,
	resolvePatientSelection,
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
		"当前微信账号暂无绑定的就诊人",
	);
	expect(patientSelectionResolutionMessage(stale)).toBe(
		"上次选择的就诊人已失效，请重新选择",
	);
	expect(patientSelectionResolutionMessage(unavailable)).toBe(
		"该就诊人暂未完成医院档案映射，请选择其他就诊人或刷新",
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
	).toBe("该就诊人暂未完成医院档案映射，请选择其他就诊人或刷新");
	expect(
		patientContextErrorMessage(
			new ApiError("stale patient", { code: "patient-selection-stale" }),
			"备用错误",
		),
	).toBe("上次选择的就诊人已失效，请重新选择");
	expect(
		patientContextErrorMessage(new Error("内部原文不应展示"), "备用错误"),
	).toBe("备用错误");
});

test("异步患者结果必须匹配当前显式选择", () => {
	// 页面请求返回时如果本地已经换人，旧 patientId 不能继续写入页面。
	expect(isCurrentSelectedPatient("patient-a", "patient-a")).toBe(true);
	expect(isCurrentSelectedPatient("patient-a", "patient-b")).toBe(false);
	expect(isCurrentSelectedPatient("patient-a", "")).toBe(false);
});
