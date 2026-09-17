import { describe, expect, test } from "bun:test";
import { pairRawLogInvocations } from "./raw-log-invocations";
import type { RawLogEntry, RawLogTrace } from "./types";

function entry(
	direction: RawLogEntry["direction"],
	timestamp: string,
	partial: Partial<RawLogEntry> = {},
): RawLogEntry {
	return {
		timestamp,
		unit: "hospital-platform-api-v2.service",
		event:
			direction === "request"
				? "provider.request.raw"
				: "provider.response.raw",
		direction,
		operation: "directory.read",
		traceId: "trace-001",
		bodyEncoding: "plain",
		chunkCount: 1,
		complete: true,
		...partial,
	};
}

function trace(entries: RawLogEntry[]): RawLogTrace {
	return {
		entries,
		total: entries.length,
		truncated: false,
		maxEntries: 300,
		identifiers: ["trace-001"],
		since: "2026-01-01T00:00:00.000Z",
		until: "2026-01-01T01:00:00.000Z",
		matchedJournalRecords: entries.length,
	};
}

describe("raw log invocation pairing", () => {
	test("keeps retries as separate request/response invocations", () => {
		const result = pairRawLogInvocations(
			trace([
				entry("request", "2026-01-01T00:00:00.000Z", {
					bodyText: '{"attempt":1}',
				}),
				entry("response", "2026-01-01T00:00:01.000Z", {
					bodyText: '{"ok":false}',
				}),
				entry("request", "2026-01-01T00:00:02.000Z", {
					bodyText: '{"attempt":2}',
				}),
				entry("response", "2026-01-01T00:00:03.000Z", {
					bodyText: '{"ok":true}',
				}),
			]),
		);

		expect(result).toHaveLength(2);
		expect(result[0]).toMatchObject({
			attempt: 0,
			complete: true,
			request: { bodyText: '{"attempt":1}' },
			response: { bodyText: '{"ok":false}' },
		});
		expect(result[1]).toMatchObject({
			attempt: 1,
			complete: true,
			request: { bodyText: '{"attempt":2}' },
			response: { bodyText: '{"ok":true}' },
		});
	});

	test("does not mark a missing side complete", () => {
		const result = pairRawLogInvocations(
			trace([
				entry("request", "2026-01-01T00:00:00.000Z"),
				entry("response", "2026-01-01T00:00:01.000Z", {
					complete: false,
					error: "missing-chunk",
				}),
			]),
		);

		expect(result).toHaveLength(1);
		expect(result[0]?.complete).toBe(false);
		expect(result[0]?.response?.error).toBe("missing-chunk");
	});

	test("keeps transport and logical raw evidence in separate layers", () => {
		const result = pairRawLogInvocations(
			trace([
				entry("request", "2026-01-01T00:00:00.000Z"),
				entry("response", "2026-01-01T00:00:01.000Z"),
				entry("request", "2026-01-01T00:00:02.000Z", {
					event: "provider.request.logical.raw",
				}),
				entry("response", "2026-01-01T00:00:03.000Z", {
					event: "provider.response.logical.raw",
				}),
			]),
		);

		expect(result.map((item) => item.layer)).toEqual(["transport", "logical"]);
	});
});
