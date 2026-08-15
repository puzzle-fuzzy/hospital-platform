import { createNotConfiguredGateways } from "@hospital/adapters";
import { createNotConfiguredRepositories } from "@hospital/persistence";
import {
	AuthService,
	createNotConfiguredSessionTokenService,
	type SessionTokenService,
} from "./modules/auth";
import { PatientService } from "./modules/patients";

export type ApplicationServices = {
	auth: AuthService;
	patients: PatientService;
	sessions: SessionTokenService;
};

/** 默认组合根只安装 fail-closed 依赖，避免开发环境误连真实 provider。 */
export function createDefaultApplicationServices(): ApplicationServices {
	const gateways = createNotConfiguredGateways();
	const repositories = createNotConfiguredRepositories();
	const sessions = createNotConfiguredSessionTokenService();

	return {
		auth: new AuthService({
			identityGateway: gateways.wechatIdentity,
			identityUsers: repositories.identityUsers,
			sessions,
		}),
		patients: new PatientService(repositories.patients),
		sessions,
	};
}
