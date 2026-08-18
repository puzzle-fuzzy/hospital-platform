import { expect, test } from "bun:test";
import {
	normalizePatientReadModel,
	PatientReadModelValidationError,
} from "./patients";

const basePatient = {
	id: "patient-internal-001",
	ownerUserId: "owner-001",
	displayName: "张三",
	relationship: "self",
	cardNumberMasked: "12345*********7890",
	source: "hospital-his",
	clinicalAccess: "ready",
} as const;

test("患者读模型只返回白名单字段并固定当前 owner", () => {
	const result = normalizePatientReadModel(
		[
			{
				...basePatient,
				// 仓储未来即使带出 provider 引用，也不能进入公共读模型。
				providerPatientId: "must-not-leak",
			},
		],
		"owner-001",
	);

	expect(result).toEqual([basePatient]);
	expect(result[0]).not.toHaveProperty("providerPatientId");
});

test("患者读模型拒绝错 owner、重复 ID 和非法展示字段", () => {
	for (const [patient, violation] of [
		[{ ...basePatient, ownerUserId: "other-owner" }, "patient-owner-mismatch"],
		[basePatient, "patient-id-duplicate"],
		[{ ...basePatient, displayName: "张\n三" }, "patient-display-name-invalid"],
	] as const) {
		const input =
			violation === "patient-id-duplicate" ? [patient, patient] : [patient];
		expect(() => normalizePatientReadModel(input, "owner-001")).toThrow(
			new PatientReadModelValidationError(violation),
		);
	}
});
