import cors from "@elysiajs/cors";
import openapi from "@elysiajs/openapi";
import { Elysia } from "elysia";
import {
	HealthResponse,
	PingResponse,
	ReadyResponse,
	success,
} from "@hospital/contracts";
import { config } from "./config";

export function createApp() {
	const app = new Elysia({ name: "hospital-api" })
		.use(cors({ origin: true }))
		.use(
			openapi({
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
			}),
		)
		.onRequest(({ set }) => {
			set.headers["x-request-id"] = crypto.randomUUID();
		})
		.onError(({ code, error, set }) => {
			const status =
				code === "NOT_FOUND" ? 404 : code === "VALIDATION" ? 422 : 500;
			set.status = status;
			return {
				success: false,
				error: {
					code: String(code).toLowerCase(),
					message:
						error instanceof Error ? error.message : "Internal Server Error",
				},
			};
		})
		.get(
			"/health/live",
			() =>
				success({
					status: "ok",
					service: "hospital-api",
					version: config.apiVersion,
				}),
			{ tags: ["health"], response: { 200: HealthResponse } },
		)
		.get(
			"/health/ready",
			() =>
				success({
					status: "not_ready",
					dependencies: {
						database: "not_configured",
						redis: "not_configured",
					},
				}),
			{ tags: ["health"], response: { 200: ReadyResponse } },
		)
		.group("/api/v1", (api) =>
			api.get(
				"/system/ping",
				() =>
					success({ service: "hospital-api", apiVersion: config.apiVersion }),
				{ tags: ["system"], response: { 200: PingResponse } },
			),
		);

	return app;
}

export type HospitalApp = ReturnType<typeof createApp>;
