import {
	mapWechatPaymentNotification,
	createWechatIdentityGateway,
	createWechatPaymentGateway,
	verifyAndDecryptWechatPaymentNotification,
} from "@hospital/adapters";
import { createLogger } from "@hospital/observability";
import { createPersistenceRuntime } from "@hospital/persistence";
import { createApp } from "./app";
import { createDefaultApplicationServices } from "./application";
import { config } from "./config";
import { createReadinessService } from "./infrastructure/readiness";
import type { WechatPaymentNotificationDecoder } from "./modules/payments";

const logger = createLogger({
	service: "hospital-api",
	environment: config.environment,
	level: config.logLevel,
});
const persistence = createPersistenceRuntime({
	databaseUrl: config.databaseUrl,
	redisUrl: config.redisUrl,
	...(config.paymentDataEncryptionKey
		? { paymentDataEncryptionKey: config.paymentDataEncryptionKey }
		: {}),
	useRepositories: config.persistenceSchemaReady,
});
const identityGateway = config.wechatIdentityReady
	? createWechatIdentityGateway({
			appId: config.wechatAppId ?? "",
			appSecret: config.wechatAppSecret ?? "",
			baseUrl: config.wechatIdentityBaseUrl,
		})
	: undefined;
const wechatPaymentGateway = config.wechatPaymentReady
	? createWechatPaymentGateway({
			appId: config.wechatPayAppId ?? "",
			mchId: config.wechatPayMchId ?? "",
			merchantCertificateSerial:
				config.wechatPayMerchantCertificateSerial ?? "",
			merchantPrivateKey: config.wechatPayMerchantPrivateKey ?? "",
			platformCertificateSerial:
				config.wechatPayPlatformCertificateSerial ?? "",
			platformPublicKey: config.wechatPayPlatformPublicKey ?? "",
			apiV3Key: config.wechatPayApiV3Key ?? "",
			notifyUrl: config.wechatPayNotifyUrl ?? "",
			baseUrl: config.wechatPayBaseUrl,
		})
	: undefined;
const apiV3Key = config.wechatPayApiV3Key;
const platformCertificateSerial = config.wechatPayPlatformCertificateSerial;
const platformPublicKey = config.wechatPayPlatformPublicKey;
const wechatPaymentNotificationDecoder:
	| WechatPaymentNotificationDecoder
	| undefined =
	config.wechatPaymentReady &&
	apiV3Key &&
	platformCertificateSerial &&
	platformPublicKey
		? ({
				rawBody,
				headers,
				receivedAt,
			}: Parameters<WechatPaymentNotificationDecoder>[0]) =>
				mapWechatPaymentNotification({
					notification: verifyAndDecryptWechatPaymentNotification({
						rawBody,
						headers,
						options: {
							platformCertificateSerial,
							platformPublicKey,
							apiV3Key,
							...(config.wechatPayAppId
								? { expectedAppId: config.wechatPayAppId }
								: {}),
							...(config.wechatPayMchId
								? { expectedMchId: config.wechatPayMchId }
								: {}),
						},
					}),
					receivedAt,
				})
		: undefined;
const app = createApp({
	logger,
	services: createDefaultApplicationServices({
		...(persistence.repositories
			? { repositories: persistence.repositories }
			: {}),
		...(persistence.sessions ? { sessionStore: persistence.sessions } : {}),
		...(identityGateway ? { identityGateway } : {}),
		...(wechatPaymentGateway ? { wechatPaymentGateway } : {}),
		...(wechatPaymentNotificationDecoder
			? { wechatPaymentNotificationDecoder }
			: {}),
	}),
	readiness: createReadinessService({
		databaseConfigured: Boolean(config.databaseUrl),
		redisConfigured: Boolean(config.redisUrl),
		databaseProbe: () => persistence.database.check(),
		redisProbe: () => persistence.redis.check(),
	}),
});

app.onStop(async () => {
	await persistence.close();
});

app.listen({ hostname: config.host, port: config.port });

logger.info(
	{
		event: "service.started",
		host: config.host,
		port: config.port,
	},
	"Hospital API listening",
);
