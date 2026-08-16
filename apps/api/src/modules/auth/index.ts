import { Elysia } from "elysia";
import {
	AuthSessionResponse,
	CurrentUserResponse,
	success,
	WechatLoginRequest,
} from "@hospital/contracts";
import { adapterContextFromHeaders } from "../../plugins/request-context";
import { createRequestPrincipalResolver } from "../../plugins/request-authentication";
import type { AuthService, SessionTokenService } from "./service";

/** 患者端登录入口：只接收微信临时 code，不接收或返回 provider secret。 */
export function authModule(
	authService: AuthService,
	sessions: SessionTokenService,
) {
	const authentication = createRequestPrincipalResolver(sessions, [
		"/auth/wechat",
	]);
	return (
		new Elysia({ name: "auth-module" })
			.onTransform({ as: "local" }, authentication.authenticate)
			// 小程序只提交 wx.login 产生的一次性 code，身份兑换始终发生在服务端。
			.post(
				"/auth/wechat",
				async ({ body, headers }) =>
					success(
						await authService.login(body, adapterContextFromHeaders(headers)),
					),
				{
					body: WechatLoginRequest,
					response: { 200: AuthSessionResponse },
					tags: ["auth"],
				},
			)
			// 会话恢复只验证平台 Bearer token，不把 provider subject 返回给客户端。
			.get(
				"/me",
				async ({ request }) => {
					const principal = await authentication.get(request);
					return success({ user: { id: principal.userId } });
				},
				{
					response: { 200: CurrentUserResponse },
					tags: ["auth"],
				},
			)
	);
}

export {
	AuthService,
	createInMemorySessionTokenService,
	createNotConfiguredSessionTokenService,
	createRedisSessionTokenService,
	requirePrincipal,
} from "./service";
export type { SessionPrincipal, SessionTokenService } from "./service";
