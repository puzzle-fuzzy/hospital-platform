import { describe, expect, test } from "bun:test";
import {
	buildPaymentDaySnapshot,
	paymentDayWindow,
	paymentInterfaceDetail,
	publicPaymentDay,
} from "./payment-day";

function journalLine(
	message: Record<string, unknown>,
	asBytes = false,
): string {
	const serialized = JSON.stringify(message);
	return JSON.stringify({
		_SYSTEMD_UNIT: "hospital-platform-api-v2.service",
		MESSAGE: asBytes ? [...new TextEncoder().encode(serialized)] : serialized,
	});
}

function rawLine({
	event,
	time,
	direction,
	body,
	traceId,
	providerRequestId,
	asBytes = false,
}: {
	event: string;
	time: string;
	direction: "request" | "response";
	body: string;
	traceId: string;
	providerRequestId: string;
	asBytes?: boolean;
}): string {
	const field =
		direction === "request"
			? "providerRequestBodyText"
			: "providerResponseBodyText";
	return journalLine(
		{
			event,
			time,
			traceId,
			providerRequestId,
			provider: "test-provider",
			operation: "registration-self-pay.2.6.65.2.plugin",
			providerRequestUrl: "https://provider.test/2.6.65.2",
			providerRequestHeadersText: '{"content-type":"application/json"}',
			[field]: body,
			[`${field}Encoding`]: "plain",
			[`${field}ChunkIndex`]: 0,
			[`${field}ChunkCount`]: 1,
			[`${field}ByteLength`]: new TextEncoder().encode(body).byteLength,
			[`${field}EncodedByteLength`]: new TextEncoder().encode(body).byteLength,
		},
		asBytes,
	);
}

describe("payment day attribution", () => {
	test("keeps a midnight-crossing interface with the order that started that day", () => {
		const serialized = [
			journalLine({
				event: "medical-insurance.authorization.requested",
				time: "2026-09-16T15:59:40.000Z",
				orderId: "order-before",
				appointmentId: "appointment-before",
			}),
			journalLine(
				{
					event: "medical-insurance.authorization.requested",
					time: "2026-09-16T16:00:05.000Z",
					orderId: "order-current",
					appointmentId: "appointment-current",
					traceId: "trace-current",
				},
				true,
			),
			rawLine({
				event: "provider.request.raw",
				time: "2026-09-16T15:59:59.000Z",
				direction: "request",
				body: '{"step":"before"}',
				traceId: "trace-current",
				providerRequestId: "provider-current",
			}),
			rawLine({
				event: "provider.response.raw",
				time: "2026-09-16T16:00:20.000Z",
				direction: "response",
				body: '{"ok":true}',
				traceId: "trace-current",
				providerRequestId: "provider-current",
				asBytes: true,
			}),
			rawLine({
				event: "provider.response.raw",
				time: "2026-09-16T16:00:02.000Z",
				direction: "response",
				body: '{"wrongOrder":true}',
				traceId: "trace-before",
				providerRequestId: "provider-before",
			}),
		].join("\n");

		const snapshot = buildPaymentDaySnapshot("2026-09-17", serialized);
		const result = publicPaymentDay(snapshot);
		const flow = result.orders[0];

		expect(result.orders).toHaveLength(1);
		expect(flow?.orderId).toBe("order-current");
		expect(flow?.hasBoundaryCrossing).toBe(true);
		expect(flow?.interfaceCount).toBe(1);
		expect(flow?.interfaces[0]).toMatchObject({
			boundary: "before-day",
			displayOperation: "2.6.65.2",
			complete: true,
		});
		expect(flow?.interfaces[0]).not.toHaveProperty("request");
		expect(flow?.interfaces[0]).not.toHaveProperty("response");

		const detail = paymentInterfaceDetail(snapshot, flow?.id || "", 1);
		expect(detail?.request?.bodyText).toBe('{"step":"before"}');
		expect(detail?.response?.bodyText).toBe('{"ok":true}');
	});

	test("uses an exclusive Beijing day window and rejects invalid dates", () => {
		const window = paymentDayWindow("2026-09-17");
		expect(window.start.toISOString()).toBe("2026-09-16T16:00:00.000Z");
		expect(window.endExclusive.toISOString()).toBe("2026-09-17T16:00:00.000Z");
		expect(() => paymentDayWindow("2026-02-30")).toThrow(
			"payment-day-date-invalid",
		);
	});
});
