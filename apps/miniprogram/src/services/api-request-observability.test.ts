import { afterEach, expect, test } from "bun:test";
import {
	clearApiRequestObservations,
	getRecentApiRequestObservations,
	MAX_RECENT_API_REQUEST_OBSERVATIONS,
	recordApiRequestObservation,
	sanitizeApiRequestPath,
} from "./api-request-observability";
import {
	clearClientTelemetryEvents,
	getRecentClientTelemetryEvents,
	setClientTelemetryEnvVersionForTests,
} from "./telemetry";

afterEach(() => {
	setClientTelemetryEnvVersionForTests(null);
	clearClientTelemetryEvents();
});

test("客户端观测路径会去掉患者和账单查询参数", () => {
	expect(
		sanitizeApiRequestPath(
			"/appointments/records?patientId=patient-secret&startDate=2026-08-01",
		),
	).toBe("/appointments/records");
	expect(sanitizeApiRequestPath("https://provider.invalid/raw")).toBe(
		"/unknown",
	);
	expect(sanitizeApiRequestPath("/patients#fragment")).toBe("/patients");
});

test("客户端观测环只保留最近固定数量的低敏请求元数据", () => {
	clearApiRequestObservations();
	try {
		for (
			let index = 0;
			index < MAX_RECENT_API_REQUEST_OBSERVATIONS + 2;
			index += 1
		) {
			recordApiRequestObservation({
				requestId: `request-${index}`,
				method: "GET",
				path: "/patients?patientId=must-not-be-kept",
				statusCode: 200,
				durationMs: index,
				outcome: "success",
			});
		}

		const observations = getRecentApiRequestObservations();
		expect(observations).toHaveLength(MAX_RECENT_API_REQUEST_OBSERVATIONS);
		expect(observations[0]?.requestId).toBe("request-2");
		expect(observations.at(-1)?.requestId).toBe(
			`request-${MAX_RECENT_API_REQUEST_OBSERVATIONS + 1}`,
		);
		expect(observations.every((item) => item.path === "/patients")).toBe(true);
		const copy = getRecentApiRequestObservations();
		copy.pop();
		expect(getRecentApiRequestObservations()).toHaveLength(
			MAX_RECENT_API_REQUEST_OBSERVATIONS,
		);
	} finally {
		clearApiRequestObservations();
	}
});

test("develop 环境附带脱敏的中转请求与响应摘要，并同步进入统一遥测流", () => {
	clearApiRequestObservations();
	setClientTelemetryEnvVersionForTests("develop");
	try {
		recordApiRequestObservation(
			{
				requestId: "request-preview-1",
				method: "POST",
				path: "/auth/wechat",
				statusCode: 200,
				durationMs: 120,
				outcome: "success",
			},
			{
				requestData: { code: "081Abcdefghijklmnopqrstuvwxyz123456" },
				responseData: {
					success: true,
					data: {
						accessToken: "secret-session-token",
						expiresInSeconds: 3600,
					},
				},
			},
		);

		const [observation] = getRecentApiRequestObservations();
		expect(observation?.envelope).toEqual({
			success: true,
			dataType: "object",
		});
		const requestPreview = observation?.requestPreview as Record<
			string,
			unknown
		>;
		expect(requestPreview.code).toBe("[已脱敏]");
		const responsePreview = observation?.responsePreview as Record<
			string,
			unknown
		>;
		expect(responsePreview.data).toBeDefined();
		const responseData = responsePreview.data as Record<string, unknown>;
		expect(responseData.accessToken).toBe("[已脱敏]");
		expect(responseData.expiresInSeconds).toBe(3600);

		const telemetryEvents = getRecentClientTelemetryEvents();
		expect(telemetryEvents).toHaveLength(1);
		expect(telemetryEvents[0]?.kind).toBe("api.request");
		expect(telemetryEvents[0]?.target).toBe("/auth/wechat");
		expect(telemetryEvents[0]?.fields?.statusCode).toBe(200);
		// 正文摘要只进控制台观测，不进统一事件流。
		expect(
			JSON.stringify(telemetryEvents[0]).includes("secret-session-token"),
		).toBe(false);
	} finally {
		clearApiRequestObservations();
		clearClientTelemetryEvents();
	}
});

test("release 环境保留封套摘要，但请求与响应正文一律不记录", () => {
	clearApiRequestObservations();
	setClientTelemetryEnvVersionForTests("release");
	try {
		recordApiRequestObservation(
			{
				requestId: "request-release-1",
				method: "GET",
				path: "/patients",
				statusCode: 200,
				durationMs: 80,
				outcome: "success",
			},
			{
				responseData: {
					success: true,
					data: { items: [{ displayName: "张三" }], total: 1 },
				},
			},
		);
		recordApiRequestObservation(
			{
				requestId: "request-release-2",
				method: "GET",
				path: "/reports",
				statusCode: 401,
				durationMs: 15,
				outcome: "http-error",
				errorCode: "unauthorized",
			},
			{
				responseData: {
					error: { code: "unauthorized", message: "会话已过期，请重新登录" },
				},
			},
		);

		const [success, failure] = getRecentApiRequestObservations();
		expect(success?.envelope).toEqual({
			success: true,
			dataType: "object",
			itemCount: 1,
			total: 1,
		});
		expect("responsePreview" in (success ?? {})).toBe(false);
		expect("requestPreview" in (success ?? {})).toBe(false);
		expect(failure?.envelope).toEqual({
			errorCode: "unauthorized",
			message: "会话已过期，请重新登录",
		});

		const telemetryEvents = getRecentClientTelemetryEvents();
		expect(telemetryEvents).toHaveLength(2);
		expect(telemetryEvents[0]?.fields?.itemCount).toBe(1);
		expect(telemetryEvents[1]?.outcome).toBe("failed");
		expect(telemetryEvents[1]?.errorName).toBe("unauthorized");
	} finally {
		clearApiRequestObservations();
		clearClientTelemetryEvents();
	}
});
