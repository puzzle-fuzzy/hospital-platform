import { Elysia, t } from "elysia";
import { PatientListResponse, success } from "@hospital/contracts";
import type { PatientService } from "./service";
import { requirePrincipal, type SessionTokenService } from "../auth/service";

const AuthorizationHeaders = t.Object({
	authorization: t.Optional(t.String({ maxLength: 512 })),
});

/** 患者档案读取入口；患者归属从 token 解析，路由不接受 ownerUserId 参数。 */
export function patientsModule(
	patientService: PatientService,
	sessions: SessionTokenService,
) {
	return new Elysia({ name: "patients-module" }).get(
		"/patients",
		async ({ headers }) => {
			const principal = await requirePrincipal(headers.authorization, sessions);
			return success(await patientService.list(principal.userId));
		},
		{
			headers: AuthorizationHeaders,
			response: { 200: PatientListResponse },
			tags: ["patients"],
		},
	);
}

export { PatientService } from "./service";
