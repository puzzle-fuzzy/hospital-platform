import { expect, test } from "bun:test";
import {
	normalizeUserProfileReadModel,
	UserProfileReadModelValidationError,
} from "./user-profile";

const baseProfile = {
	userId: "user-profile-001",
	displayName: "张三",
	gender: "male",
	age: 32,
	email: "user@example.com",
	version: 1,
} as const;

test("普通资料读模型只返回白名单字段并固定当前 userId", () => {
	const result = normalizeUserProfileReadModel(
		[
			{
				...baseProfile,
				// 仓储未来即使返回身份或审计扩展字段，也不能进入资料 API。
				openid: "must-not-leak",
			},
		][0],
		"user-profile-001",
	);

	expect(result).toEqual(baseProfile);
	expect(result).not.toHaveProperty("openid");
});

test("普通资料读模型拒绝错 owner、非法正文和错误版本", () => {
	for (const [profile, violation] of [
		[{ ...baseProfile, userId: "other-user" }, "profile-user-mismatch"],
		[{ ...baseProfile, displayName: "张\n三" }, "profile-display-name-invalid"],
		[{ ...baseProfile, email: "not-an-email" }, "profile-email-invalid"],
		[{ ...baseProfile, version: 0 }, "profile-version-invalid"],
	] as const) {
		expect(() =>
			normalizeUserProfileReadModel(profile, "user-profile-001"),
		).toThrow(new UserProfileReadModelValidationError(violation));
	}
});
