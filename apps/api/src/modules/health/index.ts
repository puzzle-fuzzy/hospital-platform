import { Elysia } from "elysia";
import { HealthResponse, ReadyResponse, success } from "@hospital/contracts";
import type { ReadinessService } from "../../infrastructure/readiness";

export function healthModule(readiness: ReadinessService) {
	return (
		new Elysia({ name: "health-module" })
			// 健康状态是瞬时探针结果，禁止 Nginx/CDN 缓存旧的 ready 或 not_ready。
			.onAfterHandle(({ set }) => {
				set.headers["cache-control"] = "no-store";
			})
			.get(
				"/health/live",
				() =>
					success({
						status: "ok",
						service: "hospital-api",
						version: "0.1.0",
					}),
				{ tags: ["health"], response: { 200: HealthResponse } },
			)
			.get("/health/ready", async () => success(await readiness.snapshot()), {
				tags: ["health"],
				response: { 200: ReadyResponse },
			})
	);
}
