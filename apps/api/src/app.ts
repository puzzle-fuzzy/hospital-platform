import cors from "@elysiajs/cors";
import openapi from "@elysiajs/openapi";
import { Elysia } from "elysia";
import {
	createDefaultApplicationServices,
	type ApplicationServices,
} from "./application";
import { config } from "./config";
import {
	createReadinessService,
	type ReadinessService,
} from "./infrastructure/readiness";
import { healthModule } from "./modules/health";
import { systemModule } from "./modules/system";
import { authModule } from "./modules/auth";
import { patientsModule } from "./modules/patients";
import { errorHandlerPlugin } from "./plugins/error-handler";
import { requestContextPlugin } from "./plugins/request-context";

export type AppOptions = {
	readiness?: ReadinessService;
	services?: ApplicationServices;
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
		});
	const services = options.services ?? createDefaultApplicationServices();

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
		.use(openApiPlugin())
		.use(healthModule(readiness))
		.group("/api/v1", (api) =>
			api
				.use(systemModule())
				.use(authModule(services.auth))
				.use(patientsModule(services.patients, services.sessions)),
		);

	return app;
}

export type HospitalApp = ReturnType<typeof createApp>;
