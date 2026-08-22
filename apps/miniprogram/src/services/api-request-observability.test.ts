import { expect, test } from "bun:test";
import {
	clearApiRequestObservations,
	getRecentApiRequestObservations,
	MAX_RECENT_API_REQUEST_OBSERVATIONS,
	recordApiRequestObservation,
	sanitizeApiRequestPath,
} from "./api-request-observability";

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
		for (let index = 0; index < MAX_RECENT_API_REQUEST_OBSERVATIONS + 2; index += 1) {
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
