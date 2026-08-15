import {
	mapWechatPaymentNotification,
	createWechatIdentityGateway,
	createWechatPaymentGateway,
	verifyAndDecryptWechatPaymentNotification,
} from "@hospital/adapters";
import {
	wechatIdentityConfigurationMissingFields,
	wechatIdentityConfigurationStatus,
	wechatPaymentConfigurationMissingFields,
	wechatPaymentConfigurationStatus,
} from "@hospital/config";
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
const wechatIdentityStatus = wechatIdentityConfigurationStatus(config);
const wechatPaymentStatus = wechatPaymentConfigurationStatus(config);
const wechatIdentityMissing = wechatIdentityConfigurationMissingFields(config);
const wechatPaymentMissing = wechatPaymentConfigurationMissingFields(config);
const persistence = createPersistenceRuntime({
	databaseUrl: config.databaseUrl,
	redisUrl: config.redisUrl,
	...(config.paymentDataEncryptionKey
		? { paymentDataEncryptionKey: config.paymentDataEncryptionKey }
		: {}),
	useRepositories: config.persistenceSchemaReady,
});
const identityGateway =
	wechatIdentityStatus === "configured"
		? createWechatIdentityGateway({
				appId: config.wechatAppId ?? "",
				appSecret: config.wechatAppSecret ?? "",
				baseUrl: config.wechatIdentityBaseUrl,
			})
		: undefined;
const wechatPaymentGateway =
	wechatPaymentStatus === "configured"
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
	wechatPaymentStatus === "configured" &&
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
		schemaReady: config.persistenceSchemaReady,
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
		schemaReady: config.persistenceSchemaReady,
		wechatIdentityConfiguration: wechatIdentityStatus,
		wechatPaymentConfiguration: wechatPaymentStatus,
		...(wechatIdentityMissing.length > 0 ? { wechatIdentityMissing } : {}),
		...(wechatPaymentMissing.length > 0 ? { wechatPaymentMissing } : {}),
	},
	"Hospital API listening",
);
