import { createNotConfiguredGateways } from "@hospital/adapters";
import type {
	WechatIdentityGateway,
	WechatPaymentGateway,
} from "@hospital/domain";
import {
	DependencyNotConfiguredError,
	PaymentOrderService,
} from "@hospital/domain";
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
import { WechatPrepayService } from "./modules/payments";
import {
	WechatPaymentNotificationService,
	type WechatPaymentNotificationDecoder,
} from "./modules/payments/notification-service";

export type ApplicationServices = {
	auth: AuthService;
	patients: PatientService;
	paymentOrders: PaymentOrderService;
	wechatPrepay: WechatPrepayService;
	wechatPaymentNotifications: WechatPaymentNotificationService;
	sessions: SessionTokenService;
};

export type ApplicationServiceOptions = {
	/** 只有完成 schema migration 后才从 persistence runtime 注入。 */
	repositories?: MySqlRepositories;
	/** Redis 未配置时必须保持 fail-closed。 */
	sessionStore?: RedisSessionStore;
	/** 只有配置闸门打开时才允许注入真实微信身份 adapter。 */
	identityGateway?: WechatIdentityGateway;
	/** 只有完成微信支付商户配置和回调验收后才打开。 */
	wechatPaymentGateway?: WechatPaymentGateway;
	/** APIv3 验签、解密和白名单映射只从组合根注入。 */
	wechatPaymentNotificationDecoder?: WechatPaymentNotificationDecoder;
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
	const paymentOrders = new PaymentOrderService({
		orders: repositories.paymentOrders,
		quotes: repositories.paymentQuotes,
	});

	return {
		auth: new AuthService({
			identityGateway,
			identityUsers: repositories.identityUsers,
			sessions,
		}),
		patients: new PatientService(repositories.patients),
		paymentOrders,
		wechatPrepay: new WechatPrepayService({
			orders: paymentOrders,
			identityUsers: repositories.identityUsers,
			attempts: repositories.paymentPrepayAttempts,
			wechatPayment: options.wechatPaymentGateway ?? gateways.wechatPayment,
		}),
		wechatPaymentNotifications: new WechatPaymentNotificationService({
			notifications: repositories.wechatPaymentNotifications,
			decoder:
				options.wechatPaymentNotificationDecoder ??
				((() => {
					throw new DependencyNotConfiguredError(
						"wechat-payment-notifications",
					);
				}) as WechatPaymentNotificationDecoder),
		}),
		sessions,
	};
}
