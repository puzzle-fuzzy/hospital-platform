import { Elysia } from "elysia";
import { PingResponse, success } from "@hospital/contracts";
import { config } from "../../config";

/**
 * 系统探针只证明当前 API 进程和路由可以响应，不探测数据库、Redis 或 Provider。
 * 依赖就绪状态由独立的 `/health/ready` 负责，不能把这个公开 ping 当成业务可用证明。
 */
export function systemModule() {
	return new Elysia({ name: "system-module" }).get(
		"/system/ping",
		() => success({ service: "hospital-api", apiVersion: config.apiVersion }),
		{ tags: ["system"], response: { 200: PingResponse } },
	);
}
