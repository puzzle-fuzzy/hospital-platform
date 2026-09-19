import { describe, expect, test } from "bun:test";
import { readRawLogTraceFromSerialized } from "../apps/admin/src/raw-logs.ts";
import {
	assignRawEntriesToOrder,
	collectOrders,
	displayOperation,
	pairRawEntries,
	parseBody,
	parseRecords,
	selectOrdersForWindow,
} from "./payment-day-export.mjs";

function journalLine(message, asBytes = false) {
	const value = JSON.stringify(message);
	return JSON.stringify({
		_SYSTEMD_UNIT: "hospital-platform-api-v2.service",
		MESSAGE: asBytes ? [...new TextEncoder().encode(value)] : value,
	});
}

function rawLine({
	event,
	direction,
	body,
	traceId = "trace-1",
	time = "2026-09-17T02:00:00.000Z",
	operation = "registration-self-pay.2.6.65.2.plugin",
	providerRequestId = "provider-request-1",
}) {
	const field =
		direction === "request"
			? "providerRequestBodyText"
			: "providerResponseBodyText";
	return journalLine({
		event,
		time,
		traceId,
		provider: "test-provider",
		operation,
		providerRequestId,
		[field]: body,
		[`${field}Encoding`]: "plain",
		[`${field}ChunkIndex`]: 0,
		[`${field}ChunkCount`]: 1,
	});
}

describe("payment-day-export helpers", () => {
	test("expands nested JSON strings without changing ordinary plaintext", () => {
		const result = parseBody(
			JSON.stringify({
				passthrough_response_content:
					'{"medSetlFlag":"SUCC","parts":[{"amount":8}]}',
				signature: "abc==",
				url: "https://pay.weixin.qq.com",
			}),
		);
		expect(result).toEqual({
			passthrough_response_content: {
				medSetlFlag: "SUCC",
				parts: [{ amount: 8 }],
			},
			signature: "abc==",
			url: "https://pay.weixin.qq.com",
		});
	});

	test("uses provider interface numbers in the human-facing operation label", () => {
		expect(displayOperation("legacy-fsi.6201")).toBe("6201");
		expect(displayOperation("legacy-fsi.6202", { plaintext: true })).toBe(
			"6202（业务明文）",
		);
		expect(displayOperation("registration-self-pay.2.6.65.2.plugin")).toBe(
			"2.6.65.2",
		);
		expect(displayOperation("medical-mix-query")).toBe("混合支付查单");
	});

	test("parses string and UTF-8 byte-array MESSAGE values", () => {
		const result = parseRecords(
			[
				journalLine({
					event: "medical-insurance.authorization.requested",
					time: "2026-09-17T00:00:00.000Z",
					orderId: "order-1",
					appointmentId: "appointment-1",
				}),
				journalLine(
					{
						event: "medical-insurance.wechat-mix.requested",
						time: "2026-09-17T00:01:00.000Z",
						orderId: "order-2",
						appointmentId: "appointment-2",
					},
					true,
				),
			].join("\n"),
		);
		expect(result.records).toHaveLength(2);
		expect(result.records[1].message.event).toBe(
			"medical-insurance.wechat-mix.requested",
		);
	});

	test("keeps reauthorization records in separate appointment orders", () => {
		const result = parseRecords(
			[
				journalLine({
					event: "appointment.detail.loaded",
					time: "2026-09-17T02:52:57.000Z",
					appointmentId: "appointment-1",
				}),
				journalLine({
					event: "medical-insurance.authorization.requested",
					time: "2026-09-17T02:53:08.000Z",
					orderId: "order-1",
					appointmentId: "appointment-1",
				}),
				journalLine({
					event: "medical-insurance.cancellation.completed",
					time: "2026-09-17T02:53:35.000Z",
					orderId: "order-1",
				}),
				journalLine({
					event: "appointment.detail.loaded",
					time: "2026-09-17T02:53:36.000Z",
					appointmentId: "appointment-1",
				}),
				journalLine({
					event: "medical-insurance.authorization.requested",
					time: "2026-09-17T02:53:37.000Z",
					orderId: "order-2",
					appointmentId: "appointment-1",
				}),
			].join("\n"),
		);
		const orders = collectOrders(result.records);
		expect(orders.map((order) => order.orderId)).toEqual([
			"order-1",
			"order-2",
		]);
		expect(
			orders[0].records.some(
				(record) => record.message.event === "appointment.detail.loaded",
			),
		).toBe(true);
		expect(
			orders[1].records.some(
				(record) => record.message.event === "appointment.detail.loaded",
			),
		).toBe(true);
	});

	test("splits repeated same-trace payment component calls", () => {
		const entries = [
			{
				event: "provider.request.raw",
				direction: "request",
				timestamp: "2026-09-17T02:00:00.000Z",
				operation: "component",
				traceId: "trace-1",
				complete: true,
			},
			{
				event: "provider.response.raw",
				direction: "response",
				timestamp: "2026-09-17T02:00:00.100Z",
				operation: "component",
				traceId: "trace-1",
				complete: true,
			},
			{
				event: "provider.request.raw",
				direction: "request",
				timestamp: "2026-09-17T02:00:01.000Z",
				operation: "component",
				traceId: "trace-1",
				complete: true,
			},
			{
				event: "provider.response.raw",
				direction: "response",
				timestamp: "2026-09-17T02:00:01.100Z",
				operation: "component",
				traceId: "trace-1",
				complete: true,
			},
		];
		expect(pairRawEntries(entries)).toHaveLength(2);

		const serialized = [
			rawLine({
				event: "provider.request.raw",
				direction: "request",
				body: "request-1",
			}),
			rawLine({
				event: "provider.response.raw",
				direction: "response",
				body: "response-1",
			}),
			rawLine({
				event: "provider.request.raw",
				direction: "request",
				body: "request-2",
			}),
			rawLine({
				event: "provider.response.raw",
				direction: "response",
				body: "response-2",
			}),
		].join("\n");
		const trace = readRawLogTraceFromSerialized(
			{
				identifiers: ["trace-1"],
				since: "2026-09-17T00:00:00.000Z",
				until: "2026-09-17T23:59:59.000Z",
			},
			serialized,
		);
		expect(trace.entries).toHaveLength(4);
	});

	test("bridges every outpatient self-pay query trace back to its order", () => {
		const lines = [
			journalLine({
				event: "outpatient.self-payment.requested",
				time: "2026-09-17T02:00:00.000Z",
				orderId: "order-1",
				recordId: "record-1",
				traceId: "trace-create",
			}),
		];
		for (let index = 1; index <= 3; index += 1) {
			const traceId = `trace-query-${index}`;
			const providerRequestId = `provider-query-${index}`;
			const second = String(index).padStart(2, "0");
			lines.push(
				rawLine({
					event: "provider.request.raw",
					direction: "request",
					body: JSON.stringify({ request: index }),
					traceId,
					time: `2026-09-17T02:00:${second}.000Z`,
					operation: "registration-self-pay.2.27.2.29",
					providerRequestId,
				}),
				rawLine({
					event: "provider.response.raw",
					direction: "response",
					body: JSON.stringify({ response: index }),
					traceId,
					time: `2026-09-17T02:00:${second}.100Z`,
					operation: "registration-self-pay.2.27.2.29",
					providerRequestId,
				}),
				journalLine({
					event: "outpatient.self-payment.provider-settlement-pending",
					time: `2026-09-17T02:00:${second}.200Z`,
					orderId: "order-1",
					recordId: "record-1",
				}),
				journalLine({
					event: "http.request.completed",
					time: `2026-09-17T02:00:${second}.201Z`,
					traceId,
					method: "GET",
					path: "/api/v1/payments/outpatient/records/record-1/self-pay",
					statusCode: 200,
				}),
			);
		}
		lines.push(
			journalLine({
				event: "http.request.completed",
				time: "2026-09-17T02:00:05.000Z",
				traceId: "trace-unrelated",
				method: "GET",
				path: "/api/v1/payments/outpatient/records/record-2/self-pay",
				statusCode: 200,
			}),
		);

		const serialized = lines.join("\n");
		const parsed = parseRecords(serialized);
		const orders = collectOrders(parsed.records);
		expect(orders).toHaveLength(1);
		const order = orders[0];
		expect(order.traceBridges).toHaveLength(3);
		expect([...order.identifiers]).toContain("trace-query-1");
		expect([...order.identifiers]).toContain("trace-query-2");
		expect([...order.identifiers]).toContain("trace-query-3");
		expect([...order.identifiers]).not.toContain("trace-unrelated");

		const trace = readRawLogTraceFromSerialized(
			{
				identifiers: [...order.identifiers],
				since: "2026-09-17T00:00:00.000Z",
				until: "2026-09-17T23:59:59.000Z",
			},
			serialized,
		);
		const invocations = pairRawEntries(
			assignRawEntriesToOrder(trace.entries, order, orders),
		).filter(
			(invocation) =>
				invocation.operation === "registration-self-pay.2.27.2.29",
		);
		expect(invocations).toHaveLength(3);
		expect(
			invocations.every(
				(invocation) =>
					invocation.request?.complete && invocation.response?.complete,
			),
		).toBe(true);
	});

	test("bridges appointment self-pay query traces but never POST creation traces", () => {
		const result = parseRecords(
			[
				journalLine({
					event: "appointment.self-payment.ready",
					time: "2026-09-17T03:00:00.000Z",
					orderId: "order-registration",
					appointmentId: "appointment-1",
				}),
				journalLine({
					event: "http.request.completed",
					time: "2026-09-17T03:00:01.000Z",
					traceId: "trace-post",
					method: "POST",
					path: "/api/v1/payments/appointments/appointment-1/self-pay",
					statusCode: 200,
				}),
				journalLine({
					event: "appointment.self-payment.provider-settlement-pending",
					time: "2026-09-17T03:00:01.900Z",
					orderId: "order-registration",
					appointmentId: "appointment-1",
				}),
				journalLine({
					event: "http.request.completed",
					time: "2026-09-17T03:00:02.000Z",
					traceId: "trace-get",
					method: "GET",
					path: "/api/v1/payments/appointments/appointment-1/self-pay",
					statusCode: 200,
				}),
			].join("\n"),
		);
		const [order] = collectOrders(result.records);
		expect(order.traceBridges).toEqual([
			expect.objectContaining({
				kind: "appointment",
				traceId: "trace-get",
			}),
		]);
		expect([...order.identifiers]).not.toContain("trace-post");
	});

	test("never bridges a self-pay query to an order that starts later", () => {
		const result = parseRecords(
			[
				journalLine({
					event: "http.request.completed",
					time: "2026-09-17T03:00:00.000Z",
					traceId: "trace-before-order",
					method: "GET",
					path: "/api/v1/payments/outpatient/records/record-future/self-pay",
					statusCode: 200,
				}),
				journalLine({
					event: "outpatient.self-payment.requested",
					time: "2026-09-17T04:00:00.000Z",
					orderId: "order-future",
					recordId: "record-future",
				}),
			].join("\n"),
		);
		const [order] = collectOrders(result.records);
		expect(order.identifiers.has("trace-before-order")).toBe(false);
		expect(order.traceBridges).toHaveLength(0);
	});

	test("keeps an ambiguous reused record query trace unassigned", () => {
		const result = parseRecords(
			[
				journalLine({
					event: "outpatient.self-payment.requested",
					time: "2026-09-17T04:00:00.000Z",
					orderId: "order-old",
					recordId: "record-shared",
				}),
				journalLine({
					event: "outpatient.self-payment.requested",
					time: "2026-09-17T04:01:00.000Z",
					orderId: "order-new",
					recordId: "record-shared",
				}),
				journalLine({
					event: "outpatient.self-payment.provider-settlement-pending",
					time: "2026-09-17T04:01:59.000Z",
					orderId: "order-old",
					recordId: "record-shared",
				}),
				journalLine({
					event: "outpatient.self-payment.provider-settlement-pending",
					time: "2026-09-17T04:01:59.100Z",
					orderId: "order-new",
					recordId: "record-shared",
				}),
				journalLine({
					event: "http.request.completed",
					time: "2026-09-17T04:02:00.000Z",
					traceId: "trace-ambiguous",
					method: "GET",
					path: "/api/v1/payments/outpatient/records/record-shared/self-pay",
					statusCode: 200,
				}),
			].join("\n"),
		);
		const orders = collectOrders(result.records);
		expect(
			orders.some((order) => order.identifiers.has("trace-ambiguous")),
		).toBe(false);
	});

	test("keeps day and latest exports inside the requested start window", () => {
		const orders = [
			{ orderId: "before", started: "2026-09-17T00:59:59.999Z" },
			{ orderId: "inside-1", started: "2026-09-17T01:00:00.000Z" },
			{ orderId: "inside-2", started: "2026-09-17T01:30:00.000Z" },
			{ orderId: "after", started: "2026-09-17T02:00:00.001Z" },
		];
		const window = {
			sinceIso: "2026-09-17T01:00:00.000Z",
			untilIso: "2026-09-17T02:00:00.000Z",
		};
		expect(
			selectOrdersForWindow(orders, window).map((order) => order.orderId),
		).toEqual(["inside-1", "inside-2"]);
		expect(
			selectOrdersForWindow(orders, window, true).map((order) => order.orderId),
		).toEqual(["inside-2"]);
	});

	test("does not move payment start backward to an older worker retry", () => {
		const result = parseRecords(
			[
				journalLine({
					event: "worker.payment.medical_order_query.retry_scheduled",
					time: "2026-09-17T01:00:00.000Z",
					orderId: "order-worker-boundary",
				}),
				journalLine({
					event: "medical-insurance.authorization.requested",
					time: "2026-09-17T02:00:00.000Z",
					orderId: "order-worker-boundary",
					appointmentId: "appointment-worker-boundary",
				}),
			].join("\n"),
		);
		const [order] = collectOrders(result.records);
		expect(order.started).toBe("2026-09-17T02:00:00.000Z");
	});
});
