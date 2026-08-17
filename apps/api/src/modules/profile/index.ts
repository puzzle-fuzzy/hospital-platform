import {
	UserProfileResponse,
	UserProfileUpdateRequest,
	success,
} from "@hospital/contracts";
import { Elysia, t } from "elysia";
import { adapterContextFromHeaders } from "../../plugins/request-context";
import type { SessionTokenService } from "../auth/service";
import { createRequestPrincipalResolver } from "../../plugins/request-authentication";
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
	const authentication = createRequestPrincipalResolver(sessions);
	return new Elysia({ name: "profile-module" })
		.onTransform({ as: "local" }, authentication.authenticate)
		.get(
			"/me/profile",
			async ({ request, headers }) => {
				const principal = await authentication.get(request);
				return success(
					await profileService.get(
						principal.userId,
						adapterContextFromHeaders(headers),
					),
				);
			},
			{
				headers: ProfileHeaders,
				response: { 200: UserProfileResponse },
				tags: ["profile"],
			},
		)
		.put(
			"/me/profile",
			async ({ body, headers, request }) => {
				const principal = await authentication.get(request);
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
