import { expect, test } from "bun:test";
import {
	IdentityUserReadModelValidationError,
	normalizeIdentityUserReadModel,
} from "./patients";

const baseIdentity = {
	userId: "user-001",
	providerSubject: "openid-001",
	unionId: "unionid-001",
} as const;

test("身份仓储读模型只投影安全字段并确认 owner/provider 范围", () => {
	const result = normalizeIdentityUserReadModel(
		{
			...baseIdentity,
			sessionKey: "must-not-cross-repository-boundary",
			providerMessage: "must-not-be-logged",
		},
		{
			expectedUserId: "user-001",
			expectedProviderSubject: "openid-001",
		},
	);

	expect(result).toEqual(baseIdentity);
});

test("身份仓储读模型拒绝非法值和跨范围结果", () => {
	const cases = [
		{
			value: { ...baseIdentity, userId: "user-\u0000-001" },
			options: {},
			violation: "user-id-invalid",
		},
		{
			value: { ...baseIdentity },
			options: { expectedUserId: "other-user" },
			violation: "user-id-mismatch",
		},
		{
			value: { ...baseIdentity, providerSubject: "other-openid" },
			options: { expectedProviderSubject: "openid-001" },
			violation: "provider-subject-mismatch",
		},
		{
			value: { ...baseIdentity, unionId: "" },
			options: {},
			violation: "union-id-invalid",
		},
	] as const;

	for (const scenario of cases) {
		expect(() =>
			normalizeIdentityUserReadModel(scenario.value, scenario.options),
		).toThrow(new IdentityUserReadModelValidationError(scenario.violation));
	}
});
