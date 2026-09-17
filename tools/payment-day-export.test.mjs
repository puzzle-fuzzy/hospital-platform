import { describe, expect, test } from "bun:test";
import { readRawLogTraceFromSerialized } from "../apps/admin/src/raw-logs.ts";
import {
	collectOrders,
	displayOperation,
	pairRawEntries,
	parseBody,
	parseRecords,
} from "./payment-day-export.mjs";

function journalLine(message, asBytes = false) {
	const value = JSON.stringify(message);
	return JSON.stringify({
		_SYSTEMD_UNIT: "hospital-platform-api-v2.service",
		MESSAGE: asBytes ? [...new TextEncoder().encode(value)] : value,
	});
}

function rawLine({ event, direction, body, traceId = "trace-1" }) {
	const field =
		direction === "request"
			? "providerRequestBodyText"
			: "providerResponseBodyText";
	return journalLine({
		event,
		time: "2026-09-17T02:00:00.000Z",
		traceId,
		provider: "test-provider",
		operation: "registration-self-pay.2.6.65.2.plugin",
		providerRequestId: "provider-request-1",
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
});
