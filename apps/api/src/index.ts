import {
	createZhongyangPatientGateway,
	createZhongyangAppointmentGateway,
	createZhongyangReportGateway,
	createWechatPaymentNotificationDecoder,
	createWechatIdentityGateway,
	createWechatPaymentGateway,
} from "@hospital/adapters";
import {
	appointmentDirectoryConfigurationMissingFields,
	appointmentDirectoryConfigurationStatus,
	reportDirectoryConfigurationMissingFields,
	reportDirectoryConfigurationStatus,
	patientDirectoryConfigurationMissingFields,
	patientDirectoryConfigurationStatus,
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

const logger = createLogger({
	service: "hospital-api",
	environment: config.environment,
	level: config.logLevel,
});
const wechatIdentityStatus = wechatIdentityConfigurationStatus(config);
const wechatPaymentStatus = wechatPaymentConfigurationStatus(config);
const wechatIdentityMissing = wechatIdentityConfigurationMissingFields(config);
const wechatPaymentMissing = wechatPaymentConfigurationMissingFields(config);
const patientDirectoryStatus = patientDirectoryConfigurationStatus(config);
const patientDirectoryMissing =
	patientDirectoryConfigurationMissingFields(config);
const appointmentDirectoryStatus =
	appointmentDirectoryConfigurationStatus(config);
const appointmentDirectoryMissing =
	appointmentDirectoryConfigurationMissingFields(config);
const reportDirectoryStatus = reportDirectoryConfigurationStatus(config);
const reportDirectoryMissing =
	reportDirectoryConfigurationMissingFields(config);
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
const patientDirectoryGateway =
	patientDirectoryStatus === "configured" && config.patientDirectoryBaseUrl
		? createZhongyangPatientGateway({
				baseUrl: config.patientDirectoryBaseUrl,
				...(config.patientDirectoryAuthorizationToken
					? {
							authorizationToken: config.patientDirectoryAuthorizationToken,
						}
					: {}),
			})
		: undefined;
const appointmentDirectoryGateway =
	appointmentDirectoryStatus === "configured" && config.patientDirectoryBaseUrl
		? createZhongyangAppointmentGateway({
				baseUrl: config.patientDirectoryBaseUrl,
				...(config.patientDirectoryAuthorizationToken
					? {
							authorizationToken: config.patientDirectoryAuthorizationToken,
						}
					: {}),
			})
		: undefined;
const reportDirectoryGateway =
	reportDirectoryStatus === "configured" && config.patientDirectoryBaseUrl
		? createZhongyangReportGateway({
				baseUrl: config.patientDirectoryBaseUrl,
				...(config.patientDirectoryAuthorizationToken
					? {
							authorizationToken: config.patientDirectoryAuthorizationToken,
						}
					: {}),
			})
		: undefined;
const apiV3Key = config.wechatPayApiV3Key;
const platformCertificateSerial = config.wechatPayPlatformCertificateSerial;
const platformPublicKey = config.wechatPayPlatformPublicKey;
const wechatPaymentNotificationDecoder:
	| ReturnType<typeof createWechatPaymentNotificationDecoder>
	| undefined =
	config.wechatPaymentReady &&
	wechatPaymentStatus === "configured" &&
	apiV3Key &&
	platformCertificateSerial &&
	platformPublicKey
		? createWechatPaymentNotificationDecoder({
				platformCertificateSerial,
				platformPublicKey,
				apiV3Key,
				...(config.wechatPayAppId
					? { expectedAppId: config.wechatPayAppId }
					: {}),
				...(config.wechatPayMchId
					? { expectedMchId: config.wechatPayMchId }
					: {}),
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
		...(patientDirectoryGateway ? { patientDirectoryGateway } : {}),
		...(appointmentDirectoryGateway ? { appointmentDirectoryGateway } : {}),
		...(reportDirectoryGateway ? { reportDirectoryGateway } : {}),
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
		patientDirectoryConfiguration: patientDirectoryStatus,
		appointmentDirectoryConfiguration: appointmentDirectoryStatus,
		reportDirectoryConfiguration: reportDirectoryStatus,
		...(wechatIdentityMissing.length > 0 ? { wechatIdentityMissing } : {}),
		...(wechatPaymentMissing.length > 0 ? { wechatPaymentMissing } : {}),
		...(patientDirectoryMissing.length > 0 ? { patientDirectoryMissing } : {}),
		...(appointmentDirectoryMissing.length > 0
			? { appointmentDirectoryMissing }
			: {}),
		...(reportDirectoryMissing.length > 0 ? { reportDirectoryMissing } : {}),
	},
	"Hospital API listening",
);
