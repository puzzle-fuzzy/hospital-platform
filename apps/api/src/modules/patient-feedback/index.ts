import {
	PatientFeedbackCreateRequest,
	PatientFeedbackListResponse,
	PatientFeedbackResponse,
	success,
} from "@hospital/contracts";
import { Elysia, t } from "elysia";
import { createRequestPrincipalResolver } from "../../plugins/request-authentication";
import { adapterContextFromHeaders } from "../../plugins/request-context";
import type { SessionTokenService } from "../auth/service";
import type { PatientFeedbackService } from "./service";

const FeedbackHeaders = t.Object({
	authorization: t.Optional(t.String({ maxLength: 512 })),
	"idempotency-key": t.Optional(
		t.String({ maxLength: 128, pattern: "^[A-Za-z0-9._:-]+$" }),
	),
	"x-request-id": t.Optional(t.String({ maxLength: 128 })),
});
const FeedbackQuery = t.Object({
	patientId: t.String({ minLength: 1, maxLength: 128 }),
	kind: t.Optional(
		t.Union([t.Literal("gift-banner"), t.Literal("health-praise")]),
	),
	donateDate: t.Optional(
		t.String({
			pattern: "^\\d{4}-(?:0[1-9]|1[0-2])(?:-(?:0[1-9]|[12]\\d|3[01]))?$",
		}),
	),
	displayPublic: t.Optional(t.Boolean()),
	pageNo: t.Optional(t.String({ pattern: "^[1-9]\\d{0,4}$" })),
	pageSize: t.Optional(t.String({ pattern: "^(?:[1-9]|[1-9]\\d|100)$" })),
});

export function patientFeedbackModule(
	service: PatientFeedbackService,
	sessions: SessionTokenService,
) {
	const authentication = createRequestPrincipalResolver(sessions);
	return new Elysia({ name: "patient-feedback-module", normalize: false })
		.onTransform({ as: "local" }, authentication.authenticate)
		.get(
			"/patient-feedback",
			async ({ request, headers, query }) => {
				const principal = await authentication.get(request);
				return success(
					await service.list(
						principal.userId,
						query.patientId,
						query.kind,
						query.donateDate,
						query.displayPublic,
						query.pageNo === undefined ? undefined : Number(query.pageNo),
						query.pageSize === undefined ? undefined : Number(query.pageSize),
						adapterContextFromHeaders(headers),
					),
				);
			},
			{
				headers: FeedbackHeaders,
				query: FeedbackQuery,
				response: { 200: PatientFeedbackListResponse },
				tags: ["patient-feedback"],
			},
		)
		.post(
			"/patient-feedback",
			async ({ request, headers, body }) => {
				const principal = await authentication.get(request);
				return success(
					await service.create(
						principal.userId,
						body,
						adapterContextFromHeaders(headers),
					),
				);
			},
			{
				headers: FeedbackHeaders,
				body: PatientFeedbackCreateRequest,
				response: { 200: PatientFeedbackResponse },
				tags: ["patient-feedback"],
			},
		);
}

export type { PatientFeedbackServiceDependencies } from "./service";
export { PatientFeedbackService } from "./service";
