import {
	PatientBindingRequest,
	PatientBindingResponse,
	PatientListResponse,
	success,
} from "@hospital/contracts";
import { Elysia, t } from "elysia";
import { createRequestPrincipalResolver } from "../../plugins/request-authentication";
import { adapterContextFromHeaders } from "../../plugins/request-context";
import type { SessionTokenService } from "../auth/service";
import type { PatientBindingService } from "./binding-service";
import type { PatientService } from "./service";

const AuthorizationHeaders = t.Object({
	authorization: t.Optional(t.String({ maxLength: 512 })),
	"x-request-id": t.Optional(t.String({ maxLength: 128 })),
});

/** 同步操作需要显式幂等上下文；unionId 不允许由小程序提交。 */
const SyncPatientsHeaders = t.Object({
	authorization: t.Optional(t.String({ maxLength: 512 })),
	/** 只允许可进入请求上下文的安全 token 字符，拒绝换行和敏感资料伪装成幂等键。 */
	"idempotency-key": t.String({
		minLength: 1,
		maxLength: 128,
		pattern: "^[A-Za-z0-9._:-]+$",
	}),
	"x-request-id": t.Optional(t.String({ maxLength: 128 })),
});

/** 患者档案读取入口；患者归属从 token 解析，路由不接受 ownerUserId 参数。 */
export function patientsModule(
	patientService: PatientService,
	patientBindingService: PatientBindingService,
	sessions: SessionTokenService,
) {
	const authentication = createRequestPrincipalResolver(sessions);
	return new Elysia({ name: "patients-module" })
		.onTransform({ as: "local" }, authentication.authenticate)
		.post(
			"/patients/bind",
			async ({ request, headers, body }) => {
				const principal = await authentication.get(request);
				return success(
					await patientBindingService.bind(
						principal.userId,
						body,
						adapterContextFromHeaders(headers),
					),
				);
			},
			{
				headers: SyncPatientsHeaders,
				body: PatientBindingRequest,
				response: { 200: PatientBindingResponse },
				tags: ["patients"],
			},
		)
		.post(
			"/patients/sync",
			async ({ request, headers }) => {
				const principal = await authentication.get(request);
				return success(
					await patientService.sync(
						principal.userId,
						adapterContextFromHeaders(headers),
					),
				);
			},
			{
				headers: SyncPatientsHeaders,
				response: { 200: PatientListResponse },
				tags: ["patients"],
			},
		)
		.get(
			"/patients",
			async ({ request, headers }) => {
				const principal = await authentication.get(request);
				return success(
					await patientService.list(
						principal.userId,
						adapterContextFromHeaders(headers),
					),
				);
			},
			{
				headers: AuthorizationHeaders,
				response: { 200: PatientListResponse },
				tags: ["patients"],
			},
		);
}

export type { PatientBindingServiceDependencies } from "./binding-service";
export {
	PatientBindingInputError,
	PatientBindingService,
} from "./binding-service";
export { PatientService, PatientServiceInputError } from "./service";
