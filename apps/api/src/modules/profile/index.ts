import {
	UserProfileResponse,
	UserProfileUpdateRequest,
	success,
} from "@hospital/contracts";
import { Elysia, t } from "elysia";
import { adapterContextFromHeaders } from "../../plugins/request-context";
import { requirePrincipal, type SessionTokenService } from "../auth/service";
import type { UserProfileService } from "./service";

const ProfileHeaders = t.Object({
	authorization: t.Optional(t.String({ maxLength: 512 })),
	"x-request-id": t.Optional(t.String({ maxLength: 128 })),
});

/** 普通资料只从当前 Bearer 会话解析 owner，不接受客户端 userId。 */
export function profileModule(
	profileService: UserProfileService,
	sessions: SessionTokenService,
) {
	return new Elysia({ name: "profile-module" })
		.get(
			"/me/profile",
			async ({ headers }) => {
				const principal = await requirePrincipal(
					headers.authorization,
					sessions,
				);
				return success(await profileService.get(principal.userId));
			},
			{
				headers: ProfileHeaders,
				response: { 200: UserProfileResponse },
				tags: ["profile"],
			},
		)
		.put(
			"/me/profile",
			async ({ body, headers }) => {
				const principal = await requirePrincipal(
					headers.authorization,
					sessions,
				);
				return success(
					await profileService.update(
						principal.userId,
						body,
						adapterContextFromHeaders(headers),
					),
				);
			},
			{
				headers: ProfileHeaders,
				body: UserProfileUpdateRequest,
				response: { 200: UserProfileResponse },
				tags: ["profile"],
			},
		);
}

export { UserProfileService } from "./service";
