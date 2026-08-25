import { describe, expect, test } from "bun:test";
import {
	ClinicalReadResultValidationError,
	createClinicalReadResult,
	normalizeClinicalReadResult,
} from "./clinical-read-contract";

const base = {
	feature: "medical-record" as const,
	ownerUserId: "owner-1",
	patientId: "patient-1",
	sourceVersion: "medical-record-v1",
	observedAt: "2026-08-26T12:00:00+08:00",
};

describe("clinical read contract", () => {
	test("允许四条临床线分别表达有数据和合法空结果", () => {
		const ready = createClinicalReadResult({
			...base,
			state: "ready",
			itemCount: 2,
		});
		const empty = normalizeClinicalReadResult({
			...base,
			feature: "inpatient-center",
			state: "empty",
			itemCount: 0,
		});

		expect(ready.itemCount).toBe(2);
		expect(empty.state).toBe("empty");
	});

	test("拒绝和不可用不能伪装成空列表", () => {
		const result = normalizeClinicalReadResult({
			...base,
			feature: "electronic-consultation",
			state: "unavailable",
			itemCount: 0,
			errorCode: "provider-timeout",
		});

		expect(result.errorCode).toBe("provider-timeout");
		expect(() =>
			normalizeClinicalReadResult({
				...base,
				state: "empty",
				itemCount: 0,
				errorCode: "provider-timeout",
			}),
		).toThrowError(ClinicalReadResultValidationError);
	});

	test("ready 必须有条目，失败状态必须有固定错误码", () => {
		expect(() =>
			normalizeClinicalReadResult({
				...base,
				state: "ready",
				itemCount: 0,
			}),
		).toThrowError(ClinicalReadResultValidationError);
		expect(() =>
			normalizeClinicalReadResult({
				...base,
				state: "rejected",
				itemCount: 0,
			}),
		).toThrowError(ClinicalReadResultValidationError);
	});

	test("拒绝未知字段、无时区时间和患者范围缺失", () => {
		for (const value of [
			{ ...base, state: "empty", itemCount: 0, extra: true },
			{
				...base,
				state: "empty",
				itemCount: 0,
				observedAt: "2026-08-26T12:00:00",
			},
			{ ...base, state: "empty", itemCount: 0, patientId: "" },
		]) {
			expect(() => normalizeClinicalReadResult(value)).toThrowError(
				ClinicalReadResultValidationError,
			);
		}
	});
});
