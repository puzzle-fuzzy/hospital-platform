import { expect, test } from "bun:test";
import { createLegacyHospitalPatientAuthGateway } from "./legacy-hospital-auth";

test("旧服务微信登录返回众阳绑卡所需的用户 JWT", async () => {
	let request: { url: string; body: unknown; headers: Headers } | undefined;
	const gateway = createLegacyHospitalPatientAuthGateway({
		baseUrl: "https://test-hp.example/api/v1",
		fetcher: async (input, init) => {
			request = {
				url: String(input),
				body: JSON.parse(String(init?.body)),
				headers: new Headers(init?.headers),
			};
			return new Response(
				JSON.stringify({
					code: 0,
					success: true,
					data: {
						access_token: "legacy-jwt-for-provider",
						user: { unionid: "union-001" },
					},
				}),
				{ status: 200, headers: { "x-request-id": "legacy-auth-001" } },
			);
		},
	});

	await expect(
		gateway.exchangeWechatCode(
			{ code: "wx-code-001" },
			{
				traceId: "patient-bind-trace-001",
				idempotencyKey: "patient-bind-key-001",
			},
		),
	).resolves.toMatchObject({
		authorizationToken: "legacy-jwt-for-provider",
		unionId: "union-001",
		trace: {
			provider: "hospital-his",
			operation: "legacy-wechat-login",
			requestId: "legacy-auth-001",
		},
	});

	expect(request?.url).toBe(
		"https://test-hp.example/api/v1/system/auth/login/wechat",
	);
	expect(request?.body).toEqual({
		code: "wx-code-001",
		login_type: "小程序端",
		auto_register: true,
	});
	expect(request?.headers.get("authorization")).toBeNull();
});
