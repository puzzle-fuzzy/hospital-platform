import { expect, test } from "bun:test";
import { TypeCompiler } from "@sinclair/typebox/compiler";
import { Value } from "@sinclair/typebox/value";
import {
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
