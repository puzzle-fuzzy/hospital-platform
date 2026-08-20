import { expect, test } from "bun:test";
import {
	MAX_PATIENT_DIRECTORY_ITEMS,
	normalizePatientDirectoryResult,
	normalizePatientDirectorySnapshotResult,
	normalizePatientReadModel,
	PatientDirectoryResultValidationError,
	PatientDirectorySnapshotResultValidationError,
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

test("患者读模型超过资源上限时整批拒绝", () => {
	const patients = Array.from(
		{ length: MAX_PATIENT_DIRECTORY_ITEMS + 1 },
		(_, index) => ({
			...basePatient,
			id: `patient-internal-${index}`,
			displayName: `患者${index}`,
		}),
	);

	expect(() => normalizePatientReadModel(patients, "owner-001")).toThrow(
		new PatientReadModelValidationError("patients-too-many"),
	);
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

test("患者读模型拒绝未脱敏的完整卡号", () => {
	const fullCardNumber = {
		...basePatient,
		cardNumberMasked: "123456789012345678",
	};

	expect(() =>
		normalizePatientReadModel([fullCardNumber], "owner-001"),
	).toThrow(new PatientReadModelValidationError("patient-card-number-invalid"));
});

test("患者读模型保留未绑定哨兵值但仍要求其它卡号带掩码", () => {
	expect(
		normalizePatientReadModel(
			[{ ...basePatient, cardNumberMasked: "未绑定" }],
			"owner-001",
		),
	).toEqual([{ ...basePatient, cardNumberMasked: "未绑定" }]);
});

test("患者目录同步写入前拒绝完整卡号并重新投影安全字段", () => {
	const trace = {
		provider: "zhongyang",
		operation: "patient-list",
		requestId: "patient-directory-result-request",
	};
	const unsafeResult = {
		complete: true,
		patients: [
			{
				providerPatientId: "provider-patient-001",
				displayName: "张三",
				relationship: "self",
				cardNumberMasked: "123456789012345678",
			},
		],
		trace,
	};

	expect(() => normalizePatientDirectoryResult(unsafeResult)).toThrow(
		new PatientDirectoryResultValidationError("patient-card-number-invalid"),
	);

	expect(() =>
		normalizePatientDirectoryResult({
			...unsafeResult,
			patients: [
				{
					...unsafeResult.patients[0],
					cardNumberMasked: "12345*********7890",
					providerReferences: {
						"his-patient": "his-patient-001",
						unexpected: "must-be-rejected",
					},
				},
			],
		}),
	).toThrow(
		new PatientDirectoryResultValidationError("provider-references-invalid"),
	);

	const safeResult = normalizePatientDirectoryResult({
		complete: true,
		patients: [
			{
				providerPatientId: "provider-patient-001",
				displayName: "张三",
				relationship: "self",
				cardNumberMasked: "12345*********7890",
				providerReferences: {
					"his-patient": "his-patient-001",
				},
				providerSecret: "must-be-dropped",
			},
		],
		trace,
	});
	// 顶层未知字段不能因为最终不会进入小程序，就被带进持久化层。
	expect(safeResult).toEqual({
		complete: true,
		patients: [
			{
				providerPatientId: "provider-patient-001",
				displayName: "张三",
				relationship: "self",
				cardNumberMasked: "12345*********7890",
				providerReferences: { "his-patient": "his-patient-001" },
			},
		],
		trace,
	});
});

test("患者快照事务返回值只保留已验证的 active 读模型和失效计数", () => {
	const result = normalizePatientDirectorySnapshotResult(
		{
			activePatients: [
				{
					...basePatient,
					providerPatientId: "must-not-leak",
				},
			],
			deactivatedPatientCount: 2,
			providerRawResult: "must-not-leak",
		},
		"owner-001",
	);

	expect(result).toEqual({
		activePatients: [basePatient],
		deactivatedPatientCount: 2,
	});

	for (const value of [
		{ activePatients: [], deactivatedPatientCount: -1 },
		{
			activePatients: [{ ...basePatient, ownerUserId: "other-owner" }],
			deactivatedPatientCount: 0,
		},
	]) {
		expect(() =>
			normalizePatientDirectorySnapshotResult(value, "owner-001"),
		).toThrow(PatientDirectorySnapshotResultValidationError);
	}
});
