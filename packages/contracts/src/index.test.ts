import { expect, test } from "bun:test";
import { TypeCompiler } from "@sinclair/typebox/compiler";
import { Value } from "@sinclair/typebox/value";
import {
	UserProfileDisplayNameSchema,
	UserProfileSchema,
	UserProfileUpdateRequest,
} from "./index";

const displayNameSchema = TypeCompiler.Compile(UserProfileDisplayNameSchema);
const profileSchema = TypeCompiler.Compile(UserProfileSchema);
const updateSchema = TypeCompiler.Compile(UserProfileUpdateRequest);

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
