import { createHash } from "node:crypto";
import {
	configureProviderRequestLogger,
	createLegacyFsiGateway,
	createLegacyFsiMedicalInsuranceGateway,
	createOfficialJavaLegacyFsiCrypto,
	createWechatPaymentGateway,
	createYunhealthRegistrationSettlementGateway,
} from "@hospital/adapters";
import {
	config as defaultConfig,
	medicalInsuranceConfigurationMissingFields,
	type RuntimeConfig,
	wechatPaymentConfigurationMissingFields,
	yunhealthRegistrationSettlementConfigurationMissingFields,
} from "@hospital/config";
import type { DependencyState } from "@hospital/contracts";
import {
	type HospitalSettlementGateway,
	type PaymentOrder,
	PaymentOrderService,
	type RegistrationSelfPaySettlementContext,
} from "@hospital/domain";
import { type AppLogger, createNoopLogger } from "@hospital/observability";
import {
	createPersistenceRuntime,
	type PersistenceRuntime,
} from "@hospital/persistence";
import {
	MedicalInsuranceOrderReconciliationWorker,
	type MedicalInsuranceOrderReconciliationWorkerResult,
} from "./medical-insurance-order-reconciliation-worker";
import { OutboxWorker, type OutboxWorkerResult } from "./outbox-worker";
import { createPaymentOrderAuditEventHandler } from "./payment-order-audit-handler";
import {
	PaymentReconciliationWorker,
	type PaymentReconciliationWorkerResult,
} from "./payment-reconciliation-worker";
import { createWechatPaymentNotificationHandler } from "./wechat-payment-notification-handler";

export type WorkerRuntimeStatus = "not_configured" | "not_ready" | "ready";

export type WorkerRuntimeInitialization = {
	status: WorkerRuntimeStatus;
	dependencies?: {
		database: DependencyState;
		schema: DependencyState;
	};
	missingConfiguration?: readonly string[];
};

export type WorkerRuntime = {
	status: WorkerRuntimeStatus;
	/** 启动前执行真实依赖探针；未通过时不会进入 provider 循环。 */
	initialize(): Promise<WorkerRuntimeInitialization>;
	runOnce(): Promise<{
		outbox: OutboxWorkerResult;
		reconciliation: PaymentReconciliationWorkerResult;
		medicalInsuranceReconciliation?: MedicalInsuranceOrderReconciliationWorkerResult;
	}>;
	close(): Promise<void>;
};

type ReadyRuntimeConfig = RuntimeConfig & {
	databaseUrl: string;
	paymentDataEncryptionKey?: string;
};

const REGISTRATION_SELF_PAY_ORDER_PREFIX = "registration-self-pay:";
const REGISTRATION_MEDICAL_PLUGIN_ORDER_PREFIX =
	"registration-medical-plugin-self-pay:";

/**
 * worker 与 API 使用同一条 owner + appointment 关联规则读取医保结算上下文。
 * 三个 Provider 关联键只从加密仓储解封后的事实中投影，绝不从平台订单号补造。
 */
function resolveRegistrationSelfPayContext(
	repositories: NonNullable<PersistenceRuntime["repositories"]>,
) {
	const contextText = (
		value: Record<string, unknown>,
		keys: readonly string[],
	): string | undefined => {
		for (const key of keys) {
			const candidate = value[key];
			if (typeof candidate !== "string" && typeof candidate !== "number")
				continue;
			const normalized = String(candidate).trim();
			if (normalized) return normalized;
		}
		return undefined;
	};

	return async (input: {
		ownerUserId: string;
		appointmentId?: string;
		medicalOrderId?: string;
	}): Promise<RegistrationSelfPaySettlementContext | undefined> => {
		const medicalOrder = input.medicalOrderId
			? await repositories.medicalInsuranceOrders.findByMedicalOrderId(
					input.medicalOrderId,
				)
			: input.appointmentId
				? await repositories.medicalInsuranceOrders.findByOwnerAndAppointmentId(
						input.ownerUserId,
						input.appointmentId,
					)
				: undefined;
		if (!medicalOrder || medicalOrder.ownerUserId !== input.ownerUserId) {
			return undefined;
		}
		if (!medicalOrder?.payOrdId) return undefined;
		const settlement =
			await repositories.medicalInsuranceOrders.getSettlementContext(
				input.ownerUserId,
				medicalOrder.medicalOrderId,
			);
		if (!settlement) return undefined;
		const providerContext = settlement.plugin ?? settlement;
		if (
			!settlement.businessId.trim() ||
			!/^[0-9]+$/.test(providerContext.payingId) ||
			!/^[0-9]+$/.test(providerContext.tradingId)
		) {
			return undefined;
		}
		const networkRegister = settlement.networkRegister;
		const hospitalId = settlement.hospitalId.trim();
		const patientId = settlement.patientId.trim();
		const certNo = contextText(networkRegister, [
			"idNo",
			"id_no",
			"certNo",
			"cert_no",
		]);
		const psnName = contextText(networkRegister, [
			"netPatName",
			"net_pat_name",
			"psnName",
			"psn_name",
		]);
		const psnNo = contextText(networkRegister, [
			"memberNo",
			"member_no",
			"psnNo",
			"psn_no",
		]);
		if (!hospitalId || !patientId || !certNo || !psnName || !psnNo) {
			return undefined;
		}
		return {
			businessId: settlement.businessId,
			payingId: providerContext.payingId,
			tradingId: providerContext.tradingId,
			hospitalId,
			patientId,
			certNo,
			psnCertType:
				contextText(networkRegister, [
					"psnCertType",
					"psn_cert_type",
					"idType",
					"id_type",
				]) ?? "01",
			psnName,
			psnNo,
			patInHosId:
				contextText(networkRegister, ["patInHosId", "pat_in_hos_id"]) ?? "0",
			...(settlement.plugin
				? {
						outTradeNo: settlement.plugin.outTradeNo,
						recordCode: settlement.plugin.recordCode,
						payTypeId: settlement.plugin.payTypeId,
						payType: settlement.plugin.payType,
						workStationId: settlement.plugin.workStationId,
						...(settlement.plugin.thirdPartPayRecordId
							? {
									thirdPartPayRecordId: settlement.plugin.thirdPartPayRecordId,
								}
							: {}),
					}
				: {}),
		};
	};
}

/** Worker 先于 API 完成 .29 时，也把原始响应放回医保密文上下文。 */
function persistThirdPartPayResponse(
	repositories: NonNullable<PersistenceRuntime["repositories"]>,
	logger: AppLogger,
) {
	return async (input: {
		paymentOrder: PaymentOrder;
		registrationContext?: RegistrationSelfPaySettlementContext;
		rawResponse: string;
		thirdPartPayRecordId: string;
	}): Promise<void> => {
		const appointmentId = input.paymentOrder.idempotencyKey.startsWith(
			REGISTRATION_SELF_PAY_ORDER_PREFIX,
		)
			? input.paymentOrder.idempotencyKey.slice(
					REGISTRATION_SELF_PAY_ORDER_PREFIX.length,
				)
			: undefined;
		const medicalOrderId = input.paymentOrder.idempotencyKey.startsWith(
			REGISTRATION_MEDICAL_PLUGIN_ORDER_PREFIX,
		)
			? input.paymentOrder.idempotencyKey.slice(
					REGISTRATION_MEDICAL_PLUGIN_ORDER_PREFIX.length,
				)
			: undefined;
		if (!appointmentId && !medicalOrderId) return;
		const medicalOrder = medicalOrderId
			? await repositories.medicalInsuranceOrders.findByMedicalOrderId(
					medicalOrderId,
				)
			: await repositories.medicalInsuranceOrders.findByOwnerAndAppointmentId(
					input.paymentOrder.ownerUserId,
					appointmentId as string,
				);
		const settlement = medicalOrder
			? await repositories.medicalInsuranceOrders.getSettlementContext(
					input.paymentOrder.ownerUserId,
					medicalOrder.medicalOrderId,
				)
			: undefined;
		const plugin = settlement?.plugin;
		if (
			!medicalOrder ||
			!plugin ||
			plugin.paymentOrderId !== input.paymentOrder.orderId
		) {
			logger.warn(
				{
					event: "worker.payment.2.27.2.29.storage-skipped",
					orderId: input.paymentOrder.orderId,
					reason: "plugin-context-missing-or-mismatched",
				},
				"Worker could not persist medical insurance Yunhealth 2.27.2.29 response",
			);
			return;
		}
		await repositories.medicalInsuranceOrders.saveSettlementContext(
			input.paymentOrder.ownerUserId,
			medicalOrder.medicalOrderId,
			{
				...settlement,
				plugin: {
					...plugin,
					thirdPartPayRecordId: input.thirdPartPayRecordId,
					thirdPartPayRawResponse: input.rawResponse,
					state: "29_succeeded",
				},
			},
		);
		logger.info(
			{
				event: "worker.payment.2.27.2.29.persisted",
				orderId: input.paymentOrder.orderId,
				thirdPartPayRecordId: input.thirdPartPayRecordId,
				rawResponseBytes: new TextEncoder().encode(input.rawResponse)
					.byteLength,
				rawResponseSha256: createHash("sha256")
					.update(input.rawResponse)
					.digest("hex"),
			},
			"Worker persisted medical insurance Yunhealth 2.27.2.29 raw response",
		);
	};
}

/**
 * Worker 的持久化基础设施必须就绪，并至少打开一个完整的 provider 子 Worker。
 * 微信支付、医保查单和云健康自费回写各自 fail-closed，医保不能因为微信支付
 * 尚未打开而无法补偿；云健康 gate 不完整时也不能启动支付补偿循环。
 */
export function workerConfigurationMissingFields(runtimeConfig: RuntimeConfig) {
	const missing: string[] = [];
	if (!runtimeConfig.persistenceSchemaReady)
		missing.push("PERSISTENCE_SCHEMA_READY");
	if (!runtimeConfig.databaseUrl) missing.push("DATABASE_URL");
	const medicalInsuranceMissing =
		medicalInsuranceConfigurationMissingFields(runtimeConfig);
	if (runtimeConfig.medicalInsuranceReady)
		missing.push(...medicalInsuranceMissing);
	const yunhealthRegistrationSettlementMissing =
		yunhealthRegistrationSettlementConfigurationMissingFields(runtimeConfig);
	if (runtimeConfig.yunhealthRegistrationSettlementReady)
		missing.push(...yunhealthRegistrationSettlementMissing);
	const anyWechatPaymentReady = runtimeConfig.wechatPaymentReady;
	if (anyWechatPaymentReady) {
		if (!runtimeConfig.paymentDataEncryptionKey)
			missing.push("PAYMENT_DATA_ENCRYPTION_KEY");
		if (runtimeConfig.wechatPaymentReady)
			missing.push(...wechatPaymentConfigurationMissingFields(runtimeConfig));
	} else if (!runtimeConfig.medicalInsuranceReady) {
		missing.push("WECHAT_PAYMENT_READY");
	}
	return missing;
}

function hasWorkerConfiguration(
	runtimeConfig: RuntimeConfig,
): runtimeConfig is ReadyRuntimeConfig {
	return workerConfigurationMissingFields(runtimeConfig).length === 0;
}

function createNotConfiguredRuntime(
	missingConfiguration: readonly string[],
): WorkerRuntime {
	return {
		status: "not_configured",
		async initialize() {
			return {
				status: "not_configured",
				missingConfiguration,
			};
		},
		async runOnce() {
			return { outbox: "idle", reconciliation: "idle" };
		},
		async close() {},
	};
}

/**
 * 创建 worker 的真实组合根。
 *
 * 只有这里可以把 MySQL repository、微信 provider 和领域 service 拼起来；
 * outbox handler 与查单 worker 本身保持依赖注入，因此单元测试不需要网络或数据库。
 */
export function createWorkerRuntime(
	options: {
		runtimeConfig?: RuntimeConfig;
		logger?: AppLogger;
		/** 生产只有完成 HIS contract/验收后才注入真实回写 adapter。 */
		hospitalSettlementGateway?: HospitalSettlementGateway;
		/** 测试可注入探针和 repository；生产始终由组合根创建真实 runtime。 */
		persistence?: PersistenceRuntime;
	} = {},
): WorkerRuntime {
	const runtimeConfig = options.runtimeConfig ?? defaultConfig;
	const missingConfiguration = workerConfigurationMissingFields(runtimeConfig);
	if (!hasWorkerConfiguration(runtimeConfig))
		return createNotConfiguredRuntime(missingConfiguration);

	const logger = options.logger ?? createNoopLogger();
	// Worker 也会执行医保查单、微信查单和补偿请求；与 API 使用相同的
	// provider HTTP 审计边界，避免后台请求没有请求/响应证据。
	configureProviderRequestLogger(logger);
	const persistence =
		options.persistence ??
		createPersistenceRuntime({
			databaseUrl: runtimeConfig.databaseUrl,
			redisUrl: runtimeConfig.redisUrl,
			...(runtimeConfig.paymentDataEncryptionKey
				? { paymentDataEncryptionKey: runtimeConfig.paymentDataEncryptionKey }
				: {}),
			...(runtimeConfig.medicalInsuranceCredentialEncryptionKey
				? {
						medicalInsuranceCredentialEncryptionKey:
							runtimeConfig.medicalInsuranceCredentialEncryptionKey,
					}
				: {}),
			useRepositories: true,
		});
	const repositories = persistence.repositories;
	if (!repositories) {
		void persistence.close();
		return createNotConfiguredRuntime(["PERSISTENCE_REPOSITORIES"]);
	}

	const wechatPayment = runtimeConfig.wechatPaymentReady
		? createWechatPaymentGateway({
				appId: runtimeConfig.wechatPayAppId ?? "",
				mchId: runtimeConfig.wechatPayMchId ?? "",
				merchantCertificateSerial:
					runtimeConfig.wechatPayMerchantCertificateSerial ?? "",
				merchantPrivateKey: runtimeConfig.wechatPayMerchantPrivateKey ?? "",
				platformCertificateSerial:
					runtimeConfig.wechatPayPlatformCertificateSerial ?? "",
				platformPublicKey: runtimeConfig.wechatPayPlatformPublicKey ?? "",
				apiV3Key: runtimeConfig.wechatPayApiV3Key ?? "",
				notifyUrl: runtimeConfig.wechatPayNotifyUrl ?? "",
				baseUrl: runtimeConfig.wechatPayBaseUrl,
			})
		: undefined;
	// worker 不创建旧 v2 微信订单；对已由 APIv3 收款的订单，仍允许云健康
	// .29/.15/.5 作为 HIS 回写补偿链路执行。
	const orders = new PaymentOrderService({
		orders: repositories.paymentOrders,
	});
	const hospitalSettlementGateway =
		runtimeConfig.yunhealthRegistrationSettlementReady &&
		yunhealthRegistrationSettlementConfigurationMissingFields(runtimeConfig)
			.length === 0
			? createYunhealthRegistrationSettlementGateway({
					baseUrl: runtimeConfig.yunhealthBaseUrl ?? "",
					authorizationToken: runtimeConfig.yunhealthAuthorizationToken ?? "",
					paymentOrgId: runtimeConfig.yunhealthPaymentOrgId ?? "",
					pluginPayTypeId:
						runtimeConfig.yunhealthRegistrationPluginPayTypeId ?? "",
					pluginPayType: (runtimeConfig.yunhealthRegistrationPluginPayType ??
						"") as "CREDIT" | "POS" | "CROWD_FUNDING",
					workStationId: runtimeConfig.yunhealthRegistrationWorkStationId ?? "",
					paymentSource: runtimeConfig.yunhealthRegistrationPaymentSource,
					authSysCode: runtimeConfig.yunhealthRegistrationAuthSysCode,
					tradeTypeCode: runtimeConfig.yunhealthRegistrationTradeTypeCode,
					logger,
				})
			: undefined;
	const outbox = new OutboxWorker(
		repositories.outbox,
		{
			"payment-order.created": createPaymentOrderAuditEventHandler({ logger }),
			"payment-order.state-changed": createPaymentOrderAuditEventHandler({
				logger,
			}),
			"payment.wechat-notification.received":
				createWechatPaymentNotificationHandler({ orders, logger }),
		},
		logger,
	);
	const settlementGateway =
		options.hospitalSettlementGateway ?? hospitalSettlementGateway;
	const reconciliation = wechatPayment
		? new PaymentReconciliationWorker({
				attempts: repositories.paymentPrepayAttempts,
				orders,
				wechatPayment,
				...(settlementGateway ? { hospitalSettlement: settlementGateway } : {}),
				resolveRegistrationContext:
					resolveRegistrationSelfPayContext(repositories),
				onThirdPartPayResponse: persistThirdPartPayResponse(
					repositories,
					logger,
				),
				logger,
			})
		: undefined;
	const medicalInsuranceGateway =
		runtimeConfig.medicalInsuranceReady &&
		medicalInsuranceConfigurationMissingFields(runtimeConfig).length === 0 &&
		runtimeConfig.zhongyangBaseUrl
			? createLegacyFsiMedicalInsuranceGateway({
					legacyFsi: createLegacyFsiGateway({
						relayUrl: runtimeConfig.medicalInsuranceRelayUrl ?? "",
						directBaseUrl: runtimeConfig.medicalInsuranceDirectBaseUrl ?? "",
						relayAuthorizationToken:
							runtimeConfig.medicalInsuranceRelayAuthorizationToken ?? "",
						crypto: createOfficialJavaLegacyFsiCrypto({
							appId: runtimeConfig.medicalInsuranceAppId ?? "",
							appSecret: runtimeConfig.medicalInsuranceAppSecret ?? "",
							channelPrivateKeyB64:
								runtimeConfig.medicalInsuranceSm2PrivateKeyB64 ?? "",
							platformPublicKeyB64:
								runtimeConfig.medicalInsuranceSm2PlatformPublicKeyB64 ?? "",
							...(runtimeConfig.medicalInsuranceJavaSdkDirectory
								? {
										sdkDirectory:
											runtimeConfig.medicalInsuranceJavaSdkDirectory,
									}
								: {}),
							verifyResponseStrict: runtimeConfig.medicalInsuranceVerifyStrict,
						}),
						logger,
						allowUnverifiedResponse:
							!runtimeConfig.medicalInsuranceVerifyStrict,
					}),
					orders: repositories.medicalInsuranceOrders,
					authorizations: repositories.medicalInsuranceAuthorizations,
					credentials: repositories.medicalInsuranceCredentials,
					relayUrl: runtimeConfig.medicalInsuranceRelayUrl ?? "",
					relayAuthorizationToken:
						runtimeConfig.medicalInsuranceRelayAuthorizationToken ?? "",
					foundationBaseUrl:
						runtimeConfig.medicalInsuranceFoundationBaseUrl ?? "",
					zhongyangBaseUrl: runtimeConfig.zhongyangBaseUrl,
					...(runtimeConfig.zhongyangAuthorizationToken
						? {
								zhongyangAuthorizationToken:
									runtimeConfig.zhongyangAuthorizationToken,
							}
						: {}),
					userQueryBaseUrl: runtimeConfig.medicalInsuranceUserQueryBaseUrl,
					userQueryPath: runtimeConfig.medicalInsuranceUserQueryPath,
					orgCode: runtimeConfig.medicalInsuranceOrgCode,
					hospitalId: runtimeConfig.medicalInsuranceHospitalId,
					insutype: runtimeConfig.medicalInsuranceInsutype,
					insuCode: runtimeConfig.medicalInsuranceInsuCode,
					logger,
				})
			: undefined;
	const medicalInsuranceReconciliation = medicalInsuranceGateway
		? new MedicalInsuranceOrderReconciliationWorker({
				tasks: repositories.medicalInsuranceQueryTasks,
				orders: repositories.medicalInsuranceOrders,
				medicalInsurance: medicalInsuranceGateway,
				logger,
			})
		: undefined;

	let status: WorkerRuntimeStatus = "not_ready";
	let closed = false;
	let initialization: Promise<WorkerRuntimeInitialization> | undefined;
	const close = async () => {
		if (closed) return;
		closed = true;
		await persistence.close();
	};
	const initialize = (): Promise<WorkerRuntimeInitialization> => {
		if (initialization) return initialization;
		initialization = (async () => {
			const [database, schema] = await Promise.all([
				safeDependencyCheck(persistence.database),
				safeDependencyCheck(persistence.schema),
			]);
			const dependencies = { database, schema };
			if (database === "ok" && schema === "ok") {
				status = "ready";
				return { status, dependencies };
			}

			status = "not_ready";
			await close();
			return { status, dependencies };
		})();
		return initialization;
	};

	return {
		get status() {
			return status;
		},
		initialize,
		async runOnce() {
			if (status !== "ready" || closed) {
				return { outbox: "idle", reconciliation: "idle" };
			}
			const now = new Date();
			const result = {
				outbox: await outbox.runOnce(now),
				reconciliation: reconciliation
					? await reconciliation.runOnce(now)
					: ("idle" as const),
			};
			if (medicalInsuranceReconciliation) {
				return {
					...result,
					medicalInsuranceReconciliation:
						await medicalInsuranceReconciliation.runOnce(now),
				};
			}
			return result;
		},
		close,
	};
}

/** 依赖端口本身也必须 fail-closed，避免探针异常冒泡成假 ready。 */
async function safeDependencyCheck(port: {
	check(): Promise<DependencyState>;
}): Promise<DependencyState> {
	try {
		return await port.check();
	} catch {
		return "unavailable";
	}
}

/** 只计算状态，不打开连接；适合启动探针和单元测试。 */
export function workerConfigurationStatus(
	runtimeConfig: RuntimeConfig = defaultConfig,
): WorkerRuntimeStatus {
	return hasWorkerConfiguration(runtimeConfig) ? "ready" : "not_configured";
}

/**
 * 运行持久化驱动的 worker 循环。
 * SIGINT/SIGTERM 只停止新 tick，当前数据库事务完成后再关闭连接池。
 */
export async function runWorkerLoop(
	runtime: WorkerRuntime,
	options: {
		intervalMs: number;
		logger: AppLogger;
		/** 显式传入入口解析出的运行模式，避免测试/生产日志互相误判。 */
		environment?: RuntimeConfig["environment"];
	},
): Promise<void> {
	const runtimeEnvironment = options.environment ?? defaultConfig.environment;
	const initialization = await runtime.initialize();
	if (initialization.status !== "ready") {
		const configured = initialization.status !== "not_configured";
		options.logger[configured ? "error" : "warn"](
			{
				event: configured ? "service.start.failed" : "service.start.skipped",
				// 启动探针失败时进程会提前退出，仍必须记录运行模式；否则
				// 排查“开发配置误部署到生产”时只能看到失败原因，无法确认
				// 这条日志究竟来自 development、test 还是 production 实例。
				runtimeMode: runtimeEnvironment,
				status: initialization.status,
				...(initialization.dependencies
					? { dependencies: initialization.dependencies }
					: {}),
				...(initialization.missingConfiguration
					? { missingConfiguration: initialization.missingConfiguration }
					: {}),
			},
			configured
				? "Hospital worker persistence is not ready; no provider work will run"
				: "Hospital worker configuration is incomplete; no provider work will run",
		);
		await runtime.close();
		return;
	}
	let stopping = false;
	const stop = () => {
		stopping = true;
	};
	process.on("SIGINT", stop);
	process.on("SIGTERM", stop);
	options.logger.info(
		{
			event: "service.started",
			// worker 不监听 HTTP 端口，但仍必须打印运行模式，便于区分开发轮询与生产轮询。
			runtimeMode: runtimeEnvironment,
			status: runtime.status,
		},
		`Hospital worker started in ${runtimeEnvironment} mode`,
	);
	try {
		while (!stopping) {
			const startedAt = Date.now();
			try {
				await runtime.runOnce();
			} catch (error) {
				options.logger.error(
					{
						event: "worker.loop.failed",
						errorName: error instanceof Error ? error.name : "UnknownError",
					},
					"Hospital worker tick failed",
				);
			}
			const remaining = Math.max(
				0,
				options.intervalMs - (Date.now() - startedAt),
			);
			if (!stopping && remaining > 0) await Bun.sleep(remaining);
		}
	} finally {
		process.off("SIGINT", stop);
		process.off("SIGTERM", stop);
		await runtime.close();
		options.logger.info(
			{ event: "service.stopped", status: runtime.status },
			"Hospital worker stopped",
		);
	}
}
