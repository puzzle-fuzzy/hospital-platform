import { InpatientEpisodeListResponse, success } from "@hospital/contracts";
import { Elysia, t } from "elysia";
import { createRequestPrincipalResolver } from "../../plugins/request-authentication";
import { adapterContextFromHeaders } from "../../plugins/request-context";
import type { SessionTokenService } from "../auth/service";
import type { InpatientEpisodeService } from "./service";

const InpatientEpisodeHeaders = t.Object({
	authorization: t.Optional(t.String({ maxLength: 512 })),
	"x-request-id": t.Optional(t.String({ maxLength: 128 })),
});

const InpatientEpisodeQuery = t.Object({
	patientId: t.String({ minLength: 1, maxLength: 128 }),
});

/** 住院页面只查询旧服务住院摘要，不暴露费用、账单或支付路由。 */
export function inpatientEpisodesModule(
	service: InpatientEpisodeService,
	sessions: SessionTokenService,
) {
	const authentication = createRequestPrincipalResolver(sessions);
	return new Elysia({ name: "inpatient-episodes-module" })
		.onTransform({ as: "local" }, authentication.authenticate)
		.get(
			"/inpatient/episodes",
			async ({ request, headers, query }) => {
				const principal = await authentication.get(request);
				return success(
					await service.list(
						principal.userId,
						query.patientId,
						adapterContextFromHeaders(headers),
					),
				);
			},
			{
				headers: InpatientEpisodeHeaders,
				query: InpatientEpisodeQuery,
				response: { 200: InpatientEpisodeListResponse },
				tags: ["inpatient-episodes"],
			},
		);
}

export {
	InpatientEpisodePatientNotFoundError,
	InpatientEpisodeQueryError,
	InpatientEpisodeService,
} from "./service";
