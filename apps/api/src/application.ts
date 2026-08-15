import { createNotConfiguredGateways } from "@hospital/adapters";
import type { WechatIdentityGateway } from "@hospital/domain";
import { PaymentOrderService } from "@hospital/domain";
import type {
	MySqlRepositories,
	RedisSessionStore,
} from "@hospital/persistence";
import { createNotConfiguredRepositories } from "@hospital/persistence";
import {
	AuthService,
	createNotConfiguredSessionTokenService,
	createRedisSessionTokenService,
	type SessionTokenService,
} from "./modules/auth";
import { PatientService } from "./modules/patients";

export type ApplicationServices = {
	auth: AuthService;
	patients: PatientService;
	paymentOrders: PaymentOrderService;
	sessions: SessionTokenService;
};

export type ApplicationServiceOptions = {
	/** 只有完成 schema migration 后才从 persistence runtime 注入。 */
	repositories?: MySqlRepositories;
	/** Redis 未配置时必须保持 fail-closed。 */
	sessionStore?: RedisSessionStore;
	/** 只有配置闸门打开时才允许注入真实微信身份 adapter。 */
	identityGateway?: WechatIdentityGateway;
};

/** 默认组合根只安装 fail-closed 依赖，避免开发环境误连真实 provider。 */
export function createDefaultApplicationServices(
	options: ApplicationServiceOptions = {},
): ApplicationServices {
	const gateways = createNotConfiguredGateways();
	const identityGateway = options.identityGateway ?? gateways.wechatIdentity;
	const repositories =
		options.repositories ?? createNotConfiguredRepositories();
	const sessions = options.sessionStore
		? createRedisSessionTokenService(options.sessionStore)
		: createNotConfiguredSessionTokenService();

	return {
		auth: new AuthService({
			identityGateway,
			identityUsers: repositories.identityUsers,
			sessions,
		}),
		patients: new PatientService(repositories.patients),
		paymentOrders: new PaymentOrderService({
			orders: repositories.paymentOrders,
			quotes: repositories.paymentQuotes,
		}),
		sessions,
	};
}
