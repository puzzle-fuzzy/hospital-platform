import { describe, expect, test } from "bun:test";
import {
	MyDoctorReadModelValidationError,
	normalizeMyDoctorReadModel,
} from "./my-doctors";

const relation = {
	ownerUserId: "user-001",
	doctorId: "doctor-001",
	doctorName: "李医生",
	departmentName: "心内科",
	createdAt: "2026-09-03T00:00:00.000Z",
};

describe("my doctor domain contract", () => {
	test("normalizes a safe owner-scoped relation", () => {
		expect(normalizeMyDoctorReadModel(relation)).toEqual(relation);
	});

	test("keeps the old doctor card location boundary", () => {
		const location = "院区".padEnd(256, "-");
		expect(
			normalizeMyDoctorReadModel({ ...relation, departmentLocation: location }),
		).toMatchObject({ departmentLocation: location });
	});

	test("rejects provider or display fields with unsafe values", () => {
		expect(() =>
			normalizeMyDoctorReadModel({
				...relation,
				doctorName: "李医生\n",
			}),
		).toThrow(MyDoctorReadModelValidationError);
		expect(() =>
			normalizeMyDoctorReadModel({
				...relation,
				doctorAvatarUrl: "javascript:alert(1)",
			}),
		).toThrow(MyDoctorReadModelValidationError);
	});
});
