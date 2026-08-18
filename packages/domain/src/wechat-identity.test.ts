import { expect, test } from "bun:test";
import {
	normalizeWechatIdentityResult,
	WechatIdentityResultValidationError,
} from "./patients";

const baseResult = {
	providerSubject: "openid-001",
	unionId: "unionid-001",
	trace: {
		provider: "wechat-identity",
		operation: "code2session",
		requestId: "wechat-request-001",
	},
} as const;

test("微信身份结果只投影安全身份字段和低敏 trace", () => {
	const result = normalizeWechatIdentityResult({
		...baseResult,
		// session_key 和 provider 扩展字段不能进入 AuthService。
		sessionKey: "must-not-cross-domain",
		providerMessage: "must-not-cross-domain",
	});

	expect(result).toEqual(baseResult);
});

test("微信身份结果在写入身份表前拒绝非法运行时值", () => {
	for (const [value, violation] of [
		[
			{ ...baseResult, providerSubject: "openid-\u0000-001" },
			"provider-subject-invalid",
		],
		[{ ...baseResult, unionId: "" }, "union-id-invalid"],
		[
			{
				...baseResult,
				trace: { ...baseResult.trace, requestId: "trace\n-invalid" },
			},
			"trace-invalid",
		],
	] as const) {
		expect(() => normalizeWechatIdentityResult(value)).toThrow(
			new WechatIdentityResultValidationError(violation),
		);
	}
});
