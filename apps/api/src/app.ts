import cors from "@elysiajs/cors";
import openapi from "@elysiajs/openapi";
import { Elysia } from "elysia";
import {
	type ApplicationServices,
	createDefaultApplicationServices,
} from "./application";
import { config } from "./config";
import { createNoopLogger, type AppLogger } from "@hospital/observability";
import {
	createReadinessService,
	type ReadinessService,
} from "./infrastructure/readiness";
import { authModule } from "./modules/auth";
import { appointmentsModule } from "./modules/appointments";
import { healthModule } from "./modules/health";
import { patientsModule } from "./modules/patients";
import { paymentsModule } from "./modules/payments";
import { systemModule } from "./modules/system";
import { errorHandlerPlugin } from "./plugins/error-handler";
import { requestContextPlugin } from "./plugins/request-context";
import { requestLoggingPlugin } from "./plugins/request-logging";

export type AppOptions = {
	readiness?: ReadinessService;
	services?: ApplicationServices;
	/** 运行入口注入 Pino；测试默认使用 silent logger。 */
	logger?: AppLogger;
};

function openApiPlugin() {
	if (!config.docsEnabled) return new Elysia({ name: "openapi-disabled" });

	return openapi({
		documentation: {
			info: {
				title: "Hospital Platform API",
				version: config.apiVersion,
				description: "医院患者端与外部医疗系统的安全编排 API",
			},
			tags: [
				{ name: "health", description: "运行状态" },
				{ name: "system", description: "系统基础接口" },
				{ name: "auth", description: "患者端身份认证" },
				{ name: "patients", description: "患者档案" },
				{ name: "appointments", description: "预约目录" },
				{ name: "payments", description: "支付订单" },
			],
		},
	});
}

export function createApp(options: AppOptions = {}) {
	const readiness =
		options.readiness ??
		createReadinessService({
			databaseConfigured: Boolean(config.databaseUrl),
			redisConfigured: Boolean(config.redisUrl),
			schemaReady: config.persistenceSchemaReady,
		});
	const services = options.services ?? createDefaultApplicationServices();
	const logger = options.logger ?? createNoopLogger();

	const app = new Elysia({ name: "hospital-api" })
		.use(
			cors({
				origin:
					config.corsOrigins.length === 1 && config.corsOrigins[0] === "*"
						? true
						: config.corsOrigins,
			}),
		)
		.use(requestContextPlugin())
		.use(errorHandlerPlugin())
		// 先让统一错误处理器确定最终 HTTP 状态，再由日志插件记录可检索结果。
		.use(requestLoggingPlugin(logger))
		.use(openApiPlugin())
		.use(healthModule(readiness))
		.group("/api/v1", (api) =>
			api
				.use(systemModule())
				.use(authModule(services.auth))
				.use(patientsModule(services.patients, services.sessions))
				.use(appointmentsModule(services.appointments, services.sessions))
				.use(
					paymentsModule(
						services.paymentOrders,
						services.wechatPrepay,
						services.wechatPaymentNotifications,
						services.sessions,
					),
				),
		);

	return app;
}

export type HospitalApp = ReturnType<typeof createApp>;
