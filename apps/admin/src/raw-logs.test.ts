import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { parseJournalRawChunks, readRawLogTrace } from "./raw-logs";

function shortSha256(value: string): string {
	return createHash("sha256").update(value).digest("hex").slice(0, 16);
}

function journalLine(
	message: Record<string, unknown>,
	asBytes = false,
): string {
	const serialized = JSON.stringify(message);
	return JSON.stringify({
		_SYSTEMD_UNIT: "hospital-platform-api-v2.service",
		__REALTIME_TIMESTAMP: "1770000000000000",
		MESSAGE: asBytes ? [...new TextEncoder().encode(serialized)] : serialized,
	});
}

describe("controlled raw journald reader", () => {
	test("reassembles plain request chunks and returns only matching trace", async () => {
		const body = '{"hello":"world"}';
		const lines = [
			journalLine({
				time: "2026-02-02T01:02:03.000Z",
				event: "provider.request.raw",
				provider: "yunhealth",
				operation: "legacy-fsi.6201",
				traceId: "trace-raw-001",
				providerRequestId: "provider-001",
				providerRequestUrl: "http://provider.test/6201",
				providerRequestHeadersText: '{"content-type":"application/json"}',
				providerRequestBodyText: body.slice(0, 8),
				providerRequestBodyTextEncoding: "plain",
				providerRequestBodyTextChunkIndex: 0,
				providerRequestBodyTextChunkCount: 2,
				providerRequestBodyTextByteLength: new TextEncoder().encode(body)
					.byteLength,
				providerRequestBodyTextEncodedByteLength: new TextEncoder().encode(body)
					.byteLength,
				providerRequestBodyTextSha256: shortSha256(body),
			}),
			journalLine({
				time: "2026-02-02T01:02:03.001Z",
				event: "provider.request.raw",
				provider: "yunhealth",
				operation: "legacy-fsi.6201",
				traceId: "trace-raw-001",
				providerRequestId: "provider-001",
				providerRequestBodyText: body.slice(8),
				providerRequestBodyTextEncoding: "plain",
				providerRequestBodyTextChunkIndex: 1,
				providerRequestBodyTextChunkCount: 2,
				providerRequestBodyTextByteLength: new TextEncoder().encode(body)
					.byteLength,
				providerRequestBodyTextEncodedByteLength: new TextEncoder().encode(body)
					.byteLength,
				providerRequestBodyTextSha256: shortSha256(body),
			}),
			journalLine({
				time: "2026-02-02T01:02:03.002Z",
				event: "provider.response.raw",
				traceId: "other-trace",
				providerResponseBodyText: "ignored",
			}),
		].join("\n");
		const result = await readRawLogTrace(
			{
				identifiers: ["trace-raw-001"],
				since: "2026-02-02T01:00:00.000Z",
				until: "2026-02-02T01:10:00.000Z",
			},
			async () => lines,
		);
		expect(result.total).toBe(1);
		expect(result.entries[0]).toMatchObject({
			direction: "request",
			complete: true,
			bodyText: body,
			url: "http://provider.test/6201",
		});
	});

	test("decodes json-string-v1 once and accepts MESSAGE byte arrays", async () => {
		const body = '{"line":"第一行\\n第二行"}';
		const encoded = JSON.stringify(body);
		const chunks = [encoded.slice(0, 8), encoded.slice(8)];
		const serialized = chunks
			.map((chunk, index) =>
				journalLine(
					{
						time: `2026-02-02T01:02:0${index}.000Z`,
						event: "provider.response.raw",
						traceId: "trace-raw-002",
						providerResponseBodyText: chunk,
						providerResponseBodyTextEncoding: "json-string-v1",
						providerResponseBodyTextChunkIndex: index,
						providerResponseBodyTextChunkCount: chunks.length,
						providerResponseBodyTextByteLength: new TextEncoder().encode(body)
							.byteLength,
						providerResponseBodyTextEncodedByteLength: new TextEncoder().encode(
							encoded,
						).byteLength,
						providerResponseBodyTextSha256: shortSha256(body),
					},
					index === 0,
				),
			)
			.join("\n");
		const chunksParsed = parseJournalRawChunks(serialized);
		expect(chunksParsed).toHaveLength(2);
		const result = await readRawLogTrace(
			{
				identifiers: ["trace-raw-002"],
				since: "2026-02-02T01:00:00.000Z",
				until: "2026-02-02T01:10:00.000Z",
			},
			async () => serialized,
		);
		expect(result.entries[0]).toMatchObject({
			complete: true,
			bodyText: body,
		});
	});

	test("marks a missing chunk incomplete instead of returning partial body", async () => {
		const result = await readRawLogTrace(
			{
				identifiers: ["trace-raw-003"],
				since: "2026-02-02T01:00:00.000Z",
				until: "2026-02-02T01:10:00.000Z",
			},
			async () =>
				journalLine({
					time: "2026-02-02T01:02:03.000Z",
					event: "provider.response.raw",
					traceId: "trace-raw-003",
					providerResponseBodyText: "partial",
					providerResponseBodyTextEncoding: "plain",
					providerResponseBodyTextChunkIndex: 0,
					providerResponseBodyTextChunkCount: 2,
				}),
		);
		expect(result.entries[0]).toMatchObject({
			complete: false,
			error: "missing-chunk",
		});
		expect(result.entries[0]?.bodyText).toBeUndefined();
	});
});
