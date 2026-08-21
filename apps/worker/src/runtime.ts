import { createWechatPaymentGateway } from "@hospital/adapters";
import {
	config as defaultConfig,
	type RuntimeConfig,
	wechatPaymentConfigurationMissingFields,
} from "@hospital/config";
import type { DependencyState } from "@hospital/contracts";
import { PaymentOrderService } from "@hospital/domain";
import { type AppLogger, createNoopLogger } from "@hospital/observability";
import {
	createPersistenceRuntime,
	type PersistenceRuntime,
} from "@hospital/persistence";
import { OutboxWorker, type OutboxWorkerResult } from "./outbox-worker";
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
	}>;
	close(): Promise<void>;
};

type ReadyRuntimeConfig = RuntimeConfig & {
	databaseUrl: string;
	paymentDataEncryptionKey: string;
	wechatPayAppId: string;
	wechatPayMchId: string;
	wechatPayMerchantCertificateSerial: string;
	wechatPayMerchantPrivateKey: string;
	wechatPayPlatformCertificateSerial: string;
	wechatPayPlatformPublicKey: string;
	wechatPayApiV3Key: string;
	wechatPayNotifyUrl: string;
};

/**
 * worker 必须同时具备持久化密钥和完整微信支付 APIv3 配置。
 * 任意一项缺失都返回 not_configured，不启动半可用的 provider 进程。
 */
export function workerConfigurationMissingFields(runtimeConfig: RuntimeConfig) {
	const missing: string[] = [];
	if (!runtimeConfig.persistenceSchemaReady)
		missing.push("PERSISTENCE_SCHEMA_READY");
	if (!runtimeConfig.databaseUrl) missing.push("DATABASE_URL");
	if (!runtimeConfig.paymentDataEncryptionKey)
		missing.push("PAYMENT_DATA_ENCRYPTION_KEY");
	if (!runtimeConfig.wechatPaymentReady) {
		missing.push("WECHAT_PAYMENT_READY");
	} else {
		missing.push(...wechatPaymentConfigurationMissingFields(runtimeConfig));
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
		/** 测试可注入探针和 repository；生产始终由组合根创建真实 runtime。 */
		persistence?: PersistenceRuntime;
	} = {},
): WorkerRuntime {
	const runtimeConfig = options.runtimeConfig ?? defaultConfig;
	const missingConfiguration = workerConfigurationMissingFields(runtimeConfig);
	if (!hasWorkerConfiguration(runtimeConfig))
		return createNotConfiguredRuntime(missingConfiguration);

	const logger = options.logger ?? createNoopLogger();
	const persistence =
		options.persistence ??
		createPersistenceRuntime({
			databaseUrl: runtimeConfig.databaseUrl,
			redisUrl: runtimeConfig.redisUrl,
			paymentDataEncryptionKey: runtimeConfig.paymentDataEncryptionKey,
			useRepositories: true,
		});
	const repositories = persistence.repositories;
	if (!repositories) {
		void persistence.close();
		return createNotConfiguredRuntime(["PERSISTENCE_REPOSITORIES"]);
	}

	const wechatPayment = createWechatPaymentGateway({
		appId: runtimeConfig.wechatPayAppId,
		mchId: runtimeConfig.wechatPayMchId,
		merchantCertificateSerial: runtimeConfig.wechatPayMerchantCertificateSerial,
		merchantPrivateKey: runtimeConfig.wechatPayMerchantPrivateKey,
		platformCertificateSerial: runtimeConfig.wechatPayPlatformCertificateSerial,
		platformPublicKey: runtimeConfig.wechatPayPlatformPublicKey,
		apiV3Key: runtimeConfig.wechatPayApiV3Key,
		notifyUrl: runtimeConfig.wechatPayNotifyUrl,
		baseUrl: runtimeConfig.wechatPayBaseUrl,
	});
	const orders = new PaymentOrderService({
		orders: repositories.paymentOrders,
	});
	const outbox = new OutboxWorker(
		repositories.outbox,
		{
			"payment.wechat-notification.received":
				createWechatPaymentNotificationHandler({ orders, logger }),
		},
		logger,
	);
	const reconciliation = new PaymentReconciliationWorker({
		attempts: repositories.paymentPrepayAttempts,
		orders,
		wechatPayment,
		logger,
	});

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
			return {
				outbox: await outbox.runOnce(now),
				reconciliation: await reconciliation.runOnce(now),
			};
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
