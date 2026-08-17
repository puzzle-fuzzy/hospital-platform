import { expect, test } from "bun:test";
import type { Patient } from "../types";
import { ApiError } from "./api-client";
import {
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

test("业务页面区分没有绑定患者与已失效的历史选择", () => {
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
		requirePatientFromResolution({
			state: "selected",
			patient: patient("patient-b"),
		}),
	).toEqual(patient("patient-b"));
});
