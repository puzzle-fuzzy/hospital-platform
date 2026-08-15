import { Elysia } from "elysia";
import {
	AuthSessionResponse,
	success,
	WechatLoginRequest,
} from "@hospital/contracts";
import { adapterContextFromHeaders } from "../../plugins/request-context";
import type { AuthService } from "./service";

/** 患者端登录入口：只接收微信临时 code，不接收或返回 provider secret。 */
export function authModule(authService: AuthService) {
	return new Elysia({ name: "auth-module" }).post(
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
	);
}

export {
	AuthService,
	createInMemorySessionTokenService,
	createNotConfiguredSessionTokenService,
	requirePrincipal,
} from "./service";
export type { SessionPrincipal, SessionTokenService } from "./service";
