import {
	createLegacyFsiGateway,
	createLegacyFsiMedicalInsuranceGateway,
	createSmCryptoLegacyFsiCrypto,
	createWechatIdentityGateway,
	createWechatPaymentGateway,
	createWechatPaymentNotificationDecoder,
	createZhongyangAppointmentGateway,
	createZhongyangAppointmentPatientProfileGateway,
	createZhongyangAppointmentWriteGateway,
	createZhongyangOutpatientPaymentGateway,
	createZhongyangPatientBindingGateway,
	createZhongyangPatientGateway,
	createZhongyangReportGateway,
} from "@hospital/adapters";
import {
	appointmentDirectoryConfigurationMissingFields,
	appointmentDirectoryConfigurationStatus,
	appointmentRecordsConfigurationMissingFields,
	appointmentRecordsConfigurationStatus,
	appointmentWritesConfigurationMissingFields,
	appointmentWritesConfigurationStatus,
	medicalInsuranceConfigurationMissingFields,
	medicalInsuranceConfigurationStatus,
	outpatientPaymentConfigurationMissingFields,
	outpatientPaymentConfigurationStatus,
	patientBindingConfigurationMissingFields,
	patientBindingConfigurationStatus,
	patientDirectoryConfigurationMissingFields,
	patientDirectoryConfigurationStatus,
	reportDetailConfigurationMissingFields,
	reportDetailConfigurationStatus,
	reportDirectoryConfigurationMissingFields,
	reportDirectoryConfigurationStatus,
	wechatIdentityConfigurationMissingFields,
	wechatIdentityConfigurationStatus,
	wechatMedicalInsuranceConfigurationMissingFields,
	wechatMedicalInsuranceConfigurationStatus,
	wechatPaymentConfigurationMissingFields,
	wechatPaymentConfigurationStatus,
} from "@hospital/config";
import { createLogger } from "@hospital/observability";
import { createPersistenceRuntime } from "@hospital/persistence";
import { createApp } from "./app";
import {
	createDefaultApplicationServices,
	selectReadyRepositories,
} from "./application";
import { config } from "./config";
import { createReadinessService } from "./infrastructure/readiness";
import { MedicalInsuranceNotificationService } from "./modules/medical-insurance/service";
import { withShutdownDeadline } from "./shutdown";

/**
 * 必须小于 systemd 的 TimeoutStopSec=30s：连接回收异常时先记录失败并退出，
 * 不能把发布切换拖到 systemd SIGKILL。正常停机通常远小于这个上限。
 */
const API_SHUTDOWN_DEADLINE_MS = 10_000;

const logger = createLogger({
	service: "hospital-api",
	environment: config.environment,
	level: config.logLevel,
});
const wechatIdentityStatus = wechatIdentityConfigurationStatus(config);
const wechatPaymentStatus = wechatPaymentConfigurationStatus(config);
const wechatIdentityMissing = wechatIdentityConfigurationMissingFields(config);
const wechatPaymentMissing = wechatPaymentConfigurationMissingFields(config);
const wechatMedicalInsuranceStatus =
	wechatMedicalInsuranceConfigurationStatus(config);
const wechatMedicalInsuranceMissing =
	wechatMedicalInsuranceConfigurationMissingFields(config);
const patientDirectoryStatus = patientDirectoryConfigurationStatus(config);
const patientDirectoryMissing =
	patientDirectoryConfigurationMissingFields(config);
const patientBindingStatus = patientBindingConfigurationStatus(config);
const patientBindingMissing = patientBindingConfigurationMissingFields(config);
const appointmentDirectoryStatus =
	appointmentDirectoryConfigurationStatus(config);
const appointmentDirectoryMissing =
	appointmentDirectoryConfigurationMissingFields(config);
const appointmentRecordsStatus = appointmentRecordsConfigurationStatus(config);
const appointmentRecordsMissing =
	appointmentRecordsConfigurationMissingFields(config);
const appointmentWritesStatus = appointmentWritesConfigurationStatus(config);
const appointmentWritesMissing =
	appointmentWritesConfigurationMissingFields(config);
const outpatientPaymentStatus = outpatientPaymentConfigurationStatus(config);
const outpatientPaymentMissing =
	outpatientPaymentConfigurationMissingFields(config);
const reportDirectoryStatus = reportDirectoryConfigurationStatus(config);
const reportDirectoryMissing =
	reportDirectoryConfigurationMissingFields(config);
const reportDetailStatus = reportDetailConfigurationStatus(config);
const reportDetailMissing = reportDetailConfigurationMissingFields(config);
const persistence = createPersistenceRuntime({
	databaseUrl: config.databaseUrl,
	redisUrl: config.redisUrl,
	logger,
	...(config.paymentDataEncryptionKey
		? { paymentDataEncryptionKey: config.paymentDataEncryptionKey }
		: {}),
	...(config.medicalInsuranceCredentialEncryptionKey
		? {
				medicalInsuranceCredentialEncryptionKey:
					config.medicalInsuranceCredentialEncryptionKey,
			}
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
				...(wechatMedicalInsuranceStatus === "configured"
					? {
							medicalInsurance: {
								appId: config.wechatMedicalInsuranceAppId ?? "",
								cityId: config.wechatMedicalInsuranceCityId ?? "",
								medicalInstitutionName:
									config.wechatMedicalInsuranceInstitutionName ?? "",
								medicalInstitutionNo:
									config.wechatMedicalInsuranceInstitutionNo ?? "",
								callbackUrl: config.wechatMedicalInsuranceCallbackUrl ?? "",
								geoLocation: config.wechatMedicalInsuranceGeoLocation ?? "",
								...(config.wechatMedicalInsuranceChannelNo
									? {
											channelNo: config.wechatMedicalInsuranceChannelNo,
										}
									: {}),
								testEnvironment: config.wechatMedicalInsuranceTestEnvironment,
							},
						}
					: {}),
			})
		: undefined;
const medicalInsuranceWechatPaymentGateway =
	wechatPaymentGateway && wechatMedicalInsuranceStatus === "configured"
		? wechatPaymentGateway
		: undefined;
const patientDirectoryGateway =
	patientDirectoryStatus === "configured" && config.zhongyangBaseUrl
		? createZhongyangPatientGateway({
				baseUrl: config.zhongyangBaseUrl,
				...(config.zhongyangAuthorizationToken
					? {
							authorizationToken: config.zhongyangAuthorizationToken,
						}
					: {}),
			})
		: undefined;
const patientBindingGateway =
	patientBindingStatus === "configured" && config.zhongyangBaseUrl
		? createZhongyangPatientBindingGateway({
				baseUrl: config.zhongyangBaseUrl,
				...(config.zhongyangAuthorizationToken
					? { authorizationToken: config.zhongyangAuthorizationToken }
					: {}),
			})
		: undefined;
const appointmentGateway =
	(appointmentDirectoryStatus === "configured" ||
		appointmentRecordsStatus === "configured") &&
	config.zhongyangBaseUrl
		? createZhongyangAppointmentGateway({
				baseUrl: config.zhongyangBaseUrl,
				...(config.zhongyangAuthorizationToken
					? {
							authorizationToken: config.zhongyangAuthorizationToken,
						}
					: {}),
			})
		: undefined;
const appointmentDirectoryGateway =
	appointmentDirectoryStatus === "configured" ? appointmentGateway : undefined;
const appointmentDepartmentTreeGateway =
	appointmentDirectoryStatus === "configured" ? appointmentGateway : undefined;
const appointmentRecordDirectoryGateway =
	appointmentRecordsStatus === "configured" ? appointmentGateway : undefined;
const appointmentPatientProfileGateway =
	appointmentWritesStatus === "configured" && config.zhongyangBaseUrl
		? createZhongyangAppointmentPatientProfileGateway({
				baseUrl: config.zhongyangBaseUrl,
				...(config.zhongyangAuthorizationToken
					? { authorizationToken: config.zhongyangAuthorizationToken }
					: {}),
			})
		: undefined;
const appointmentWriteGateway =
	appointmentWritesStatus === "configured" && config.zhongyangBaseUrl
		? createZhongyangAppointmentWriteGateway({
				baseUrl: config.zhongyangBaseUrl,
				...(config.zhongyangAuthorizationToken
					? { authorizationToken: config.zhongyangAuthorizationToken }
					: {}),
			})
		: undefined;
const outpatientPaymentGateway =
	outpatientPaymentStatus === "configured" && config.zhongyangBaseUrl
		? createZhongyangOutpatientPaymentGateway({
				baseUrl: config.zhongyangBaseUrl,
				authSysCode: config.outpatientPaymentAuthSysCode,
				...(config.zhongyangAuthorizationToken
					? { authorizationToken: config.zhongyangAuthorizationToken }
					: {}),
			})
		: undefined;

const reportGateway =
	(reportDirectoryStatus === "configured" ||
		reportDetailStatus === "configured") &&
	config.zhongyangBaseUrl
		? createZhongyangReportGateway({
				baseUrl: config.zhongyangBaseUrl,
				...(config.zhongyangAuthorizationToken
					? {
							authorizationToken: config.zhongyangAuthorizationToken,
						}
					: {}),
			})
		: undefined;
const reportDirectoryGateway =
	reportDirectoryStatus === "configured" ? reportGateway : undefined;
const reportDetailGateway =
	reportDetailStatus === "configured" ? reportGateway : undefined;
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
/**
 * 支付模块的最终开关必须同时依赖真实支付 adapter 和通知解密器。
 * 仅凭环境变量字段完整不能放行订单写入：没有回调入口时，订单状态无法
 * 形成闭环，生产 API 必须继续保持 fail-closed。
 */

const medicalInsuranceMissing =
	medicalInsuranceConfigurationMissingFields(config);
const medicalInsuranceReady =
	config.medicalInsuranceReady && medicalInsuranceMissing.length === 0;
const medicalInsuranceCrypto = medicalInsuranceReady
	? createSmCryptoLegacyFsiCrypto({
			appId: config.medicalInsuranceAppId ?? "",
			appSecret: config.medicalInsuranceAppSecret ?? "",
			channelPrivateKeyB64: config.medicalInsuranceSm2PrivateKeyB64 ?? "",
			platformPublicKeyB64:
				config.medicalInsuranceSm2PlatformPublicKeyB64 ?? "",
			sm2UserId: config.medicalInsuranceSm2UserId,
		})
	: undefined;
const medicalInsuranceNotification =
	medicalInsuranceCrypto && persistence.repositories
		? new MedicalInsuranceNotificationService({
				crypto: medicalInsuranceCrypto,
				orders: persistence.repositories.medicalInsuranceOrders,
				logger,
			})
		: undefined;

const wechatPaymentEnabled = Boolean(
	wechatPaymentGateway && wechatPaymentNotificationDecoder,
);

// 启动时只执行只读探针，确认数据库、Redis 和 schema 的真实状态；这些探针不会写业务数据。
// 任一探针失败时 API 仍可监听 health/readiness，但登录和业务持久化保持 fail-closed。
const [startupDatabaseProbe, startupRedisProbe, startupSchemaProbe] =
	await Promise.all([
		persistence.database.check(),
		persistence.redis.check(),
		persistence.schema.check(),
	]);
const readyRepositories = selectReadyRepositories(
	persistence.repositories,
	startupSchemaProbe,
);
const legacyFsiGateway =
	medicalInsuranceReady && medicalInsuranceCrypto
		? createLegacyFsiGateway({
				relayUrl: config.medicalInsuranceRelayUrl ?? "",
				directBaseUrl: config.medicalInsuranceDirectBaseUrl ?? "",
				relayAuthorizationToken:
					config.medicalInsuranceRelayAuthorizationToken ?? "",
				crypto: medicalInsuranceCrypto,
			})
		: undefined;
const medicalInsuranceGateway =
	legacyFsiGateway && readyRepositories && config.zhongyangBaseUrl
		? createLegacyFsiMedicalInsuranceGateway({
				legacyFsi: legacyFsiGateway,
				orders: readyRepositories.medicalInsuranceOrders,
				authorizations: readyRepositories.medicalInsuranceAuthorizations,
				credentials: readyRepositories.medicalInsuranceCredentials,
				relayUrl: config.medicalInsuranceRelayUrl ?? "",
				relayAuthorizationToken:
					config.medicalInsuranceRelayAuthorizationToken ?? "",
				foundationBaseUrl: config.medicalInsuranceFoundationBaseUrl ?? "",
				zhongyangBaseUrl: config.zhongyangBaseUrl,
				...(config.zhongyangAuthorizationToken
					? { zhongyangAuthorizationToken: config.zhongyangAuthorizationToken }
					: {}),
				userQueryBaseUrl: config.medicalInsuranceUserQueryBaseUrl,
				userQueryPath: config.medicalInsuranceUserQueryPath,
				orgCode: config.medicalInsuranceOrgCode,
				hospitalId: config.medicalInsuranceHospitalId,
				insutype: config.medicalInsuranceInsutype,
				insuCode: config.medicalInsuranceInsuCode,
			})
		: undefined;
// 登录能力必须同时具备微信身份 adapter、MySQL 身份仓储和 Redis 会话存储；
// 任意一项缺失都记录为 fail-closed，避免启动日志把“配置完整”误报成“可登录”。
const authRuntimeStatus =
	identityGateway &&
	readyRepositories &&
	persistence.sessions &&
	startupDatabaseProbe === "ok" &&
	startupRedisProbe === "ok"
		? "ready"
		: "fail_closed";
const app = createApp({
	logger,
	services: createDefaultApplicationServices({
		logger,
		...(readyRepositories ? { repositories: readyRepositories } : {}),
		...(persistence.sessions ? { sessionStore: persistence.sessions } : {}),
		...(identityGateway ? { identityGateway } : {}),
		...(wechatPaymentGateway ? { wechatPaymentGateway } : {}),
		...(medicalInsuranceWechatPaymentGateway
			? { medicalInsuranceWechatPaymentGateway }
			: {}),
		...(patientDirectoryGateway ? { patientDirectoryGateway } : {}),
		...(patientBindingGateway ? { patientBindingGateway } : {}),
		...(appointmentDirectoryGateway ? { appointmentDirectoryGateway } : {}),
		...(appointmentDepartmentTreeGateway
			? { appointmentDepartmentTreeGateway }
			: {}),
		...(appointmentRecordDirectoryGateway
			? { appointmentRecordDirectoryGateway }
			: {}),
		...(appointmentPatientProfileGateway
			? { appointmentPatientProfileGateway }
			: {}),
		...(appointmentWriteGateway ? { appointmentWriteGateway } : {}),
		...(outpatientPaymentGateway ? { outpatientPaymentGateway } : {}),
		outpatientPaymentAuthSysCode: config.outpatientPaymentAuthSysCode,
		...(reportDirectoryGateway ? { reportDirectoryGateway } : {}),
		...(reportDetailGateway ? { reportDetailGateway } : {}),
		...(wechatPaymentNotificationDecoder
			? { wechatPaymentNotificationDecoder }
			: {}),
		...(medicalInsuranceNotification ? { medicalInsuranceNotification } : {}),
		...(medicalInsuranceGateway ? { medicalInsuranceGateway } : {}),
	}),
	wechatPaymentEnabled,
	readiness: createReadinessService({
		databaseConfigured: Boolean(config.databaseUrl),
		redisConfigured: Boolean(config.redisUrl),
		schemaReady: config.persistenceSchemaReady,
		databaseProbe: () => persistence.database.check(),
		redisProbe: () => persistence.redis.check(),
		schemaProbe: () => persistence.schema.check(),
	}),
});

app.onStop(async () => {
	await persistence.close();
});

app.listen({ hostname: config.host, port: config.port });

/**
 * API 进程必须先停止接收新请求，再触发 Elysia onStop 关闭数据库/Redis。
 * 不直接调用 process.exit，给正在处理的请求和持久化连接留下收尾时间。
 */
let stopping = false;
const stop = async (signal: "SIGINT" | "SIGTERM") => {
	if (stopping) return;
	stopping = true;
	logger.info(
		{ event: "service.stop.requested", signal },
		"Hospital API shutdown requested",
	);
	try {
		await withShutdownDeadline(() => app.stop(), API_SHUTDOWN_DEADLINE_MS);
		logger.info({ event: "service.stopped", signal }, "Hospital API stopped");
	} catch (error) {
		logger.error(
			{
				event: "service.stop.failed",
				signal,
				errorName: error instanceof Error ? error.name : "UnknownError",
			},
			"Hospital API shutdown failed",
		);
		process.exitCode = 1;
		// app.stop() 的底层连接回收不可取消；deadline 到期后主动退出，
		// 避免留下悬挂连接并再次触发 systemd 的硬 SIGKILL。
		setImmediate(() => process.exit(1));
	}
};

process.on("SIGINT", () => void stop("SIGINT"));
process.on("SIGTERM", () => void stop("SIGTERM"));

logger.info(
	{
		event: "service.started",
		// 运行模式必须出现在启动日志中，便于通过 journald/Pino 快速确认当前实例是否为生产进程。
		runtimeMode: config.environment,
		host: config.host,
		port: config.port,
		persistenceSchemaGate: config.persistenceSchemaReady,
		persistenceDatabaseProbe: startupDatabaseProbe,
		persistenceRedisProbe: startupRedisProbe,
		persistenceSchemaProbe: startupSchemaProbe,
		persistenceRepositories: readyRepositories ? "enabled" : "fail_closed",
		authRuntimeStatus,
		authIdentityGateway: identityGateway ? "injected" : "fail_closed",
		authSessionStore: persistence.sessions ? "injected" : "fail_closed",
		wechatIdentityConfiguration: wechatIdentityStatus,
		wechatPaymentConfiguration: wechatPaymentStatus,
		wechatMedicalInsuranceConfiguration: wechatMedicalInsuranceStatus,
		wechatPaymentRuntime: wechatPaymentEnabled ? "enabled" : "fail_closed",
		medicalInsuranceConfiguration: medicalInsuranceConfigurationStatus(config),
		medicalInsuranceRuntime: medicalInsuranceGateway
			? "enabled"
			: "fail_closed",
		patientDirectoryConfiguration: patientDirectoryStatus,
		patientBindingConfiguration: patientBindingStatus,
		appointmentDirectoryConfiguration: appointmentDirectoryStatus,
		appointmentRecordsConfiguration: appointmentRecordsStatus,
		appointmentWritesConfiguration: appointmentWritesStatus,
		outpatientPaymentConfiguration: outpatientPaymentStatus,
		reportDirectoryConfiguration: reportDirectoryStatus,
		reportDetailConfiguration: reportDetailStatus,
		...(wechatIdentityMissing.length > 0 ? { wechatIdentityMissing } : {}),
		...(wechatPaymentMissing.length > 0 ? { wechatPaymentMissing } : {}),
		...(wechatMedicalInsuranceMissing.length > 0
			? { wechatMedicalInsuranceMissing }
			: {}),
		...(medicalInsuranceMissing.length > 0 ? { medicalInsuranceMissing } : {}),
		...(patientDirectoryMissing.length > 0 ? { patientDirectoryMissing } : {}),
		...(patientBindingMissing.length > 0 ? { patientBindingMissing } : {}),
		...(appointmentDirectoryMissing.length > 0
			? { appointmentDirectoryMissing }
			: {}),
		...(appointmentRecordsMissing.length > 0
			? { appointmentRecordsMissing }
			: {}),
		...(appointmentWritesMissing.length > 0
			? { appointmentWritesMissing }
			: {}),
		...(outpatientPaymentMissing.length > 0
			? { outpatientPaymentMissing }
			: {}),
		...(reportDirectoryMissing.length > 0 ? { reportDirectoryMissing } : {}),
		...(reportDetailMissing.length > 0 ? { reportDetailMissing } : {}),
	},
	`Hospital API listening in ${config.environment} mode`,
);
