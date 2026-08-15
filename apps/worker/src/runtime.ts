import { createWechatPaymentGateway } from "@hospital/adapters";
import { type RuntimeConfig, config as defaultConfig } from "@hospital/config";
import { PaymentOrderService } from "@hospital/domain";
import { createNoopLogger, type AppLogger } from "@hospital/observability";
import { createPersistenceRuntime } from "@hospital/persistence";
import { OutboxWorker, type OutboxWorkerResult } from "./outbox-worker";
import {
	PaymentReconciliationWorker,
	type PaymentReconciliationWorkerResult,
} from "./payment-reconciliation-worker";
import { createWechatPaymentNotificationHandler } from "./wechat-payment-notification-handler";

export type WorkerRuntimeStatus = "not_configured" | "ready";

export type WorkerRuntime = {
	status: WorkerRuntimeStatus;
	runOnce(): Promise<{
		outbox: OutboxWorkerResult;
		reconciliation: PaymentReconciliationWorkerResult;
	}>;
	close(): Promise<void>;
};

type WorkerRequiredField =
	| "databaseUrl"
	| "paymentDataEncryptionKey"
	| "wechatPayAppId"
	| "wechatPayMchId"
	| "wechatPayMerchantCertificateSerial"
	| "wechatPayMerchantPrivateKey"
	| "wechatPayPlatformCertificateSerial"
	| "wechatPayPlatformPublicKey"
	| "wechatPayApiV3Key"
	| "wechatPayNotifyUrl";

type ReadyRuntimeConfig = RuntimeConfig & {
	[Key in WorkerRequiredField]-?: NonNullable<RuntimeConfig[Key]>;
};

/**
 * worker 必须同时具备持久化密钥和完整微信支付 APIv3 配置。
 * 任意一项缺失都返回 not_configured，不启动半可用的 provider 进程。
 */
function hasWorkerConfiguration(
	runtimeConfig: RuntimeConfig,
): runtimeConfig is ReadyRuntimeConfig {
	return Boolean(
		runtimeConfig.persistenceSchemaReady &&
			runtimeConfig.databaseUrl &&
			runtimeConfig.paymentDataEncryptionKey &&
			runtimeConfig.wechatPaymentReady &&
			runtimeConfig.wechatPayAppId &&
			runtimeConfig.wechatPayMchId &&
			runtimeConfig.wechatPayMerchantCertificateSerial &&
			runtimeConfig.wechatPayMerchantPrivateKey &&
			runtimeConfig.wechatPayPlatformCertificateSerial &&
			runtimeConfig.wechatPayPlatformPublicKey &&
			runtimeConfig.wechatPayApiV3Key &&
			runtimeConfig.wechatPayNotifyUrl,
	);
}

function createNotConfiguredRuntime(): WorkerRuntime {
	return {
		status: "not_configured",
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
	options: { runtimeConfig?: RuntimeConfig; logger?: AppLogger } = {},
): WorkerRuntime {
	const runtimeConfig = options.runtimeConfig ?? defaultConfig;
	if (!hasWorkerConfiguration(runtimeConfig))
		return createNotConfiguredRuntime();

	const logger = options.logger ?? createNoopLogger();
	const persistence = createPersistenceRuntime({
		databaseUrl: runtimeConfig.databaseUrl,
		redisUrl: runtimeConfig.redisUrl,
		paymentDataEncryptionKey: runtimeConfig.paymentDataEncryptionKey,
		useRepositories: true,
	});
	const repositories = persistence.repositories;
	if (!repositories) {
		void persistence.close();
		return createNotConfiguredRuntime();
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

	return {
		status: "ready",
		async runOnce() {
			const now = new Date();
			return {
				outbox: await outbox.runOnce(now),
				reconciliation: await reconciliation.runOnce(now),
			};
		},
		close: persistence.close,
	};
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
	},
): Promise<void> {
	if (runtime.status !== "ready") return;
	let stopping = false;
	const stop = () => {
		stopping = true;
	};
	process.on("SIGINT", stop);
	process.on("SIGTERM", stop);
	options.logger.info(
		{ event: "service.started", status: runtime.status },
		"Hospital worker started",
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
