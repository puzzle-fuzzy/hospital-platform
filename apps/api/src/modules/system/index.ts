import { Elysia } from "elysia";
import { PingResponse, success } from "@hospital/contracts";
import { config } from "../../config";

export function systemModule() {
	return new Elysia({ name: "system-module" }).get(
		"/system/ping",
		() => success({ service: "hospital-api", apiVersion: config.apiVersion }),
		{ tags: ["system"], response: { 200: PingResponse } },
	);
}
