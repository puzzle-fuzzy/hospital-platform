import { Elysia } from "elysia";
import {
	AuthSessionResponse,
	CurrentUserResponse,
	success,
	WechatLoginRequest,
} from "@hospital/contracts";
import { adapterContextFromHeaders } from "../../plugins/request-context";
import {
	requirePrincipal,
	type AuthService,
	type SessionTokenService,
} from "./service";

/** 患者端登录入口：只接收微信临时 code，不接收或返回 provider secret。 */
export function authModule(
	authService: AuthService,
	sessions: SessionTokenService,
) {
	return new Elysia({ name: "auth-module" })
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
		.get(
			"/me",
			async ({ headers }) => {
				const principal = await requirePrincipal(
					headers.authorization,
					sessions,
				);
				return success({ user: { id: principal.userId } });
			},
			{
				response: { 200: CurrentUserResponse },
				tags: ["auth"],
			},
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
