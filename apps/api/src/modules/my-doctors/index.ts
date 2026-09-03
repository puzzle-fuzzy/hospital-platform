import {
	MyDoctorDeleteResponse,
	MyDoctorFollowRequest,
	MyDoctorListResponse,
	MyDoctorResponse,
	success,
} from "@hospital/contracts";
import { Elysia, t } from "elysia";
import { createRequestPrincipalResolver } from "../../plugins/request-authentication";
import { adapterContextFromHeaders } from "../../plugins/request-context";
import type { SessionTokenService } from "../auth/service";
import type { MyDoctorService } from "./service";

const MyDoctorHeaders = t.Object({
	authorization: t.Optional(t.String({ maxLength: 512 })),
	"idempotency-key": t.Optional(
		t.String({ maxLength: 128, pattern: "^[A-Za-z0-9._:-]+$" }),
	),
	"x-request-id": t.Optional(t.String({ maxLength: 128 })),
});

const DoctorParams = t.Object({
	doctorId: t.String({ minLength: 1, maxLength: 128 }),
});

/** 我的医生所有 owner 都从 Bearer 会话解析；路由不接受 userId 或患者 ID。 */
export function myDoctorsModule(
	myDoctorService: MyDoctorService,
	sessions: SessionTokenService,
) {
	const authentication = createRequestPrincipalResolver(sessions);
	return new Elysia({ name: "my-doctors-module", normalize: false })
		.onTransform({ as: "local" }, authentication.authenticate)
		.get(
			"/my/doctors",
			async ({ request, headers }) => {
				const principal = await authentication.get(request);
				return success(
					await myDoctorService.list(
						principal.userId,
						adapterContextFromHeaders(headers),
					),
				);
			},
			{
				headers: MyDoctorHeaders,
				response: { 200: MyDoctorListResponse },
				tags: ["my-doctors"],
			},
		)
		.get(
			"/my/doctors/:doctorId",
			async ({ request, headers, params }) => {
				const principal = await authentication.get(request);
				return success(
					await myDoctorService.get(
						principal.userId,
						params.doctorId,
						adapterContextFromHeaders(headers),
					),
				);
			},
			{
				headers: MyDoctorHeaders,
				params: DoctorParams,
				response: { 200: MyDoctorResponse },
				tags: ["my-doctors"],
			},
		)
		.post(
			"/my/doctors",
			async ({ request, headers, body }) => {
				const principal = await authentication.get(request);
				return success(
					await myDoctorService.follow(
						principal.userId,
						body,
						adapterContextFromHeaders(headers),
					),
				);
			},
			{
				headers: MyDoctorHeaders,
				body: MyDoctorFollowRequest,
				response: { 200: MyDoctorResponse },
				tags: ["my-doctors"],
			},
		)
		.delete(
			"/my/doctors/:doctorId",
			async ({ request, headers, params }) => {
				const principal = await authentication.get(request);
				return success(
					await myDoctorService.unfollow(
						principal.userId,
						params.doctorId,
						adapterContextFromHeaders(headers),
					),
				);
			},
			{
				headers: MyDoctorHeaders,
				params: DoctorParams,
				response: { 200: MyDoctorDeleteResponse },
				tags: ["my-doctors"],
			},
		);
}

export { MyDoctorService } from "./service";
export type { MyDoctorServiceDependencies } from "./service";
