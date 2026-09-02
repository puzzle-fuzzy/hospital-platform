import { expect, test } from "bun:test";
import { TypeCompiler } from "@sinclair/typebox/compiler";
import { Value } from "@sinclair/typebox/value";
import {
	AppointmentDepartmentTreeResponse,
	HealthKnowledgeDiseaseDetailSchema,
	HealthKnowledgeDrugDetailSchema,
	PatientCardNumberMaskedSchema,
	PatientListResponse,
	PatientSchema,
	UserProfileDisplayNameSchema,
	UserProfileSchema,
	UserProfileUpdateRequest,
} from "./index";

const displayNameSchema = TypeCompiler.Compile(UserProfileDisplayNameSchema);
const profileSchema = TypeCompiler.Compile(UserProfileSchema);
const updateSchema = TypeCompiler.Compile(UserProfileUpdateRequest);
const patientCardNumberSchema = TypeCompiler.Compile(
	PatientCardNumberMaskedSchema,
);
const patientSchema = TypeCompiler.Compile(PatientSchema);
const patientListSchema = TypeCompiler.Compile(PatientListResponse);
const healthDiseaseDetailSchema = TypeCompiler.Compile(
	HealthKnowledgeDiseaseDetailSchema,
);
const healthDrugDetailSchema = TypeCompiler.Compile(
	HealthKnowledgeDrugDetailSchema,
);
const appointmentDepartmentTreeSchema = TypeCompiler.Compile(
	AppointmentDepartmentTreeResponse,
);

function profile(displayName: string) {
	return {
		displayName,
		gender: "unknown" as const,
		age: null,
		email: null,
		version: 1,
	};
}

test("个人资料展示名按 Unicode code point 计数，而不是 UTF-16 code unit", () => {
	const emoji64 = String.fromCodePoint(0x1f600).repeat(64);
	const mixed64 = "中😀".repeat(32);

	for (const value of ["中".repeat(64), emoji64, mixed64]) {
		expect(Array.from(value)).toHaveLength(64);
		expect(displayNameSchema.Check(value)).toBe(true);
		expect(Value.Check(UserProfileDisplayNameSchema, value)).toBe(true);
		expect(profileSchema.Check(profile(value))).toBe(true);
		expect(updateSchema.Check({ version: 1, displayName: value })).toBe(true);
	}
});

test("个人资料展示名拒绝第 65 个 Unicode code point 和孤立代理项", () => {
	const emoji65 = String.fromCodePoint(0x1f600).repeat(65);
	const isolatedHighSurrogate = `${"中".repeat(63)}\uD800`;

	for (const value of ["中".repeat(65), emoji65, isolatedHighSurrogate]) {
		expect(displayNameSchema.Check(value)).toBe(false);
		expect(Value.Check(UserProfileDisplayNameSchema, value)).toBe(false);
		expect(profileSchema.Check(profile(value))).toBe(false);
		expect(updateSchema.Check({ version: 1, displayName: value })).toBe(false);
	}
});

test("公共患者 contract 固定卡号最多前五位和后四位", () => {
	const validCard = "12345******1234";
	const legacyMaskedCard = "******7890";
	const unboundCard = "未绑定";

	for (const value of [validCard, legacyMaskedCard, unboundCard]) {
		expect(patientCardNumberSchema.Check(value)).toBe(true);
		expect(Value.Check(PatientCardNumberMaskedSchema, value)).toBe(true);
	}

	const patient = {
		id: "patient-contract-001",
		displayName: "患者甲",
		relationship: "self" as const,
		cardNumberMasked: validCard,
		source: "hospital-his" as const,
		clinicalAccess: "ready" as const,
	};
	expect(patientSchema.Check(patient)).toBe(true);
	expect(
		patientListSchema.Check({
			success: true,
			data: { items: [patient], total: 1 },
		}),
	).toBe(true);

	for (const value of [
		"123456******1234", // 前六位可见，超出页面允许的前缀边界。
		"12345********12345", // 后五位可见，超出页面允许的后缀边界。
		"123456789012345678", // 完整卡号，不包含掩码。
		"12345-******1234", // 卡号展示不允许夹带未审计分隔符。
	]) {
		expect(patientCardNumberSchema.Check(value)).toBe(false);
		expect(Value.Check(PatientCardNumberMaskedSchema, value)).toBe(false);
	}
});

test("健康知识 contract 与领域层保持可点击引用和非空文本边界", () => {
	const validDisease = {
		id: "disease-cold",
		diseaseName: "普通感冒",
		availableDrugs: [
			{ drugId: "drug-cold", drugName: "示例药物", isClickable: true },
			{ drugName: "文字药物说明", isClickable: false },
		],
		treatment: "对症处理",
	};
	const validDrug = {
		id: "drug-cold",
		drugName: "示例药物",
		manufacturer: "示例厂家",
		indications: "用于审核内容展示",
	};

	expect(healthDiseaseDetailSchema.Check(validDisease)).toBe(true);
	expect(healthDrugDetailSchema.Check(validDrug)).toBe(true);
	expect(
		healthDiseaseDetailSchema.Check({
			...validDisease,
			diseaseAlias: "",
		}),
	).toBe(false);
	expect(
		healthDiseaseDetailSchema.Check({
			...validDisease,
			availableDrugs: [{ drugName: "缺少绑定", isClickable: true }],
		}),
	).toBe(false);
});

test("预约一级二级目录 contract 仅接受受控分组和二级科室数组", () => {
	expect(
		appointmentDepartmentTreeSchema.Check({
			success: true,
			data: {
				items: [
					{
						groupId: "group-internal",
						displayName: "内科",
						departments: [
							{
								departmentId: "second-cardiology",
								displayName: "心血管内科",
							},
						],
					},
				],
				total: 1,
			},
		}),
	).toBe(true);
	expect(
		appointmentDepartmentTreeSchema.Check({
			success: true,
			data: {
				items: [
					{
						groupId: "group-internal",
						displayName: "内科",
						departments: null,
					},
				],
				total: 1,
			},
		}),
	).toBe(false);
});
