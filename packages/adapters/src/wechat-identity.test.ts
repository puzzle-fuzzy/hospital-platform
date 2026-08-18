import { expect, test } from "bun:test";
import { AdapterNotConfiguredError } from "./errors";
import { createWechatIdentityGateway } from "./wechat-identity";

const context = {
	traceId: "wechat-trace-001",
	idempotencyKey: "wechat-login-001",
};

test("wechat identity adapter maps code2session without leaking session_key", async () => {
	let capturedUrl = "";
	const gateway = createWechatIdentityGateway({
		appId: "wx-test-app",
		appSecret: "test-secret",
		fetcher: async (input) => {
			capturedUrl = String(input);
			return new Response(
				JSON.stringify({
					openid: "openid-001",
					unionid: "unionid-001",
					session_key: "must-not-cross-adapter-boundary",
				}),
				{ status: 200 },
			);
		},
	});

	const result = await gateway.exchangeCode(
		{ code: "login-code-001" },
		context,
	);

	expect(result).toEqual({
		providerSubject: "openid-001",
		unionId: "unionid-001",
		trace: {
			provider: "wechat-identity",
			operation: "code2session",
			requestId: "wechat-trace-001",
		},
	});
	expect(JSON.stringify(result)).not.toContain("session_key");
	expect(capturedUrl).toContain("appid=wx-test-app");
	expect(capturedUrl).toContain("js_code=login-code-001");
	expect(capturedUrl).toContain("grant_type=authorization_code");
});

test("wechat identity adapter classifies invalid code as non-retryable", async () => {
	const gateway = createWechatIdentityGateway({
		appId: "wx-test-app",
		appSecret: "test-secret",
		fetcher: async () =>
			new Response(JSON.stringify({ errcode: 40029, errmsg: "invalid code" }), {
				status: 200,
			}),
	});

	await expect(
		gateway.exchangeCode({ code: "invalid-code" }, context),
	).rejects.toMatchObject({
		name: "ProviderRequestError",
		provider: "wechat-identity",
		retryable: false,
	});
});

test("wechat identity adapter classifies provider busy and rate-limit errors as retryable", async () => {
	const gateway = createWechatIdentityGateway({
		appId: "wx-test-app",
		appSecret: "test-secret",
		fetcher: async () =>
			new Response(JSON.stringify({ errcode: 45011, errmsg: "rate limit" }), {
				status: 200,
			}),
	});

	await expect(
		gateway.exchangeCode({ code: "login-code" }, context),
	).rejects.toMatchObject({
		name: "ProviderRequestError",
		retryable: true,
	});
});

test("wechat identity adapter rejects a successful HTTP response without openid", async () => {
	const gateway = createWechatIdentityGateway({
		appId: "wx-test-app",
		appSecret: "test-secret",
		fetcher: async () =>
			new Response(JSON.stringify({ session_key: "must-not-be-used" }), {
				status: 200,
			}),
	});

	await expect(
		gateway.exchangeCode({ code: "login-code" }, context),
	).rejects.toMatchObject({
		name: "ProviderRequestError",
		provider: "wechat-identity",
		retryable: false,
	});
});

test("wechat identity adapter rejects malformed unionid instead of partial login", async () => {
	const gateway = createWechatIdentityGateway({
		appId: "wx-test-app",
		appSecret: "test-secret",
		fetcher: async () =>
			new Response(
				JSON.stringify({
					openid: "openid-001",
					unionid: 123,
				}),
				{ status: 200 },
			),
	});

	// 身份字段一旦异常，不能只忽略 unionid 或继续创建平台用户；否则登录
	// 会被记录为成功，但后续患者目录又因缺少合法身份而失败，形成错误的
	// “登录成功”假象。
	await expect(
		gateway.exchangeCode({ code: "login-code" }, context),
	).rejects.toMatchObject({
		name: "ProviderRequestError",
		provider: "wechat-identity",
		retryable: false,
	});
});

test("wechat identity adapter rejects control characters in openid", async () => {
	const gateway = createWechatIdentityGateway({
		appId: "wx-test-app",
		appSecret: "test-secret",
		fetcher: async () =>
			new Response(JSON.stringify({ openid: "openid-\u0000-001" }), {
				status: 200,
			}),
	});

	await expect(
		gateway.exchangeCode({ code: "login-code" }, context),
	).rejects.toMatchObject({
		name: "ProviderRequestError",
		provider: "wechat-identity",
		message: "Wechat code2session openid is invalid",
	});
});

test("wechat identity adapter rejects overlong identity values", async () => {
	const gateway = createWechatIdentityGateway({
		appId: "wx-test-app",
		appSecret: "test-secret",
		fetcher: async () =>
			new Response(JSON.stringify({ openid: "o".repeat(129) }), {
				status: 200,
			}),
	});

	await expect(
		gateway.exchangeCode({ code: "login-code" }, context),
	).rejects.toMatchObject({
		name: "ProviderRequestError",
		provider: "wechat-identity",
		message: "Wechat code2session openid is invalid",
	});
});

test("wechat identity adapter refuses incomplete credentials", () => {
	expect(() =>
		createWechatIdentityGateway({ appId: "", appSecret: "test-secret" }),
	).toThrow(AdapterNotConfiguredError);
	expect(() =>
		createWechatIdentityGateway({ appId: "wx-test-app", appSecret: "" }),
	).toThrow(AdapterNotConfiguredError);
});
