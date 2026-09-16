import { createHash } from "node:crypto";

/**
 * 原始 Provider 日志只能按单条安全日志记录受控读取，不能把整段 journald
 * 或不受限的时间范围交给浏览器。300 是接口和 UI 共同的硬上限。
 */
export const RAW_LOG_MAX_ENTRIES = 300;

const RAW_LOG_MAX_JOURNAL_BYTES = 64 * 1024 * 1024;
const RAW_LOG_MAX_BODY_BYTES = 8 * 1024 * 1024;
const RAW_EVENT_SUFFIX = ".raw";
const RAW_LOG_UNITS = [
	"hospital-platform-api-v2.service",
	"hospital-platform-worker-v2.service",
] as const;

type JsonObject = Record<string, unknown>;

export type RawLogDirection = "request" | "response";

export type RawLogEntry = {
	timestamp: string;
	unit: string;
	event: string;
	direction: RawLogDirection;
	provider?: string;
	operation?: string;
	traceId?: string;
	requestId?: string;
	providerRequestId?: string;
	method?: string;
	statusCode?: number;
	url?: string;
	headersText?: string;
	bodyEncoding: "plain" | "json-string-v1";
	chunkCount: number;
	complete: boolean;
	missingChunkIndexes?: number[];
	integrity?: {
		expectedByteLength?: number;
		actualByteLength?: number;
		expectedSha256?: string;
		actualSha256?: string;
	};
	bodyText?: string;
	error?: string;
};

export type RawLogTrace = {
	entries: RawLogEntry[];
	total: number;
	truncated: boolean;
	maxEntries: number;
	identifiers: string[];
	since: string;
	until: string;
	matchedJournalRecords: number;
};

export type RawLogTraceQuery = {
	identifiers: string[];
	since: string;
	until: string;
	maxEntries?: number;
};

type RawChunk = {
	timestamp: string;
	unit: string;
	event: string;
	direction: RawLogDirection;
	provider?: string;
	operation?: string;
	traceId?: string;
	requestId?: string;
	providerRequestId?: string;
	method?: string;
	statusCode?: number;
	url?: string;
	headersText?: string;
	bodyText: string;
	bodyEncoding: "plain" | "json-string-v1";
	chunkIndex: number;
	chunkCount: number;
	bodyByteLength?: number;
	encodedByteLength?: number;
	bodySha256?: string;
};

export type JournalCommand = (args: readonly string[]) => Promise<string>;

/**
 * journalctl 在目标 Ubuntu 环境不接受 ISO-8601 的 `T...Z` 形式；显式
 * 写出 UTC，同时保留毫秒，避免把日志窗口按服务器本地时区误解。
 */
export function formatJournalTimestamp(value: Date): string {
	return value.toISOString().replace("T", " ").replace("Z", " UTC");
}

function isObject(value: unknown): value is JsonObject {
	return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function text(value: unknown): string | undefined {
	if (typeof value !== "string") return undefined;
	const normalized = value.trim();
	return normalized ? normalized : undefined;
}

function number(value: unknown): number | undefined {
	return typeof value === "number" && Number.isFinite(value)
		? value
		: undefined;
}

function decodeJournalMessage(value: unknown): string | undefined {
	if (typeof value === "string") return value;
	if (!Array.isArray(value) || value.length > RAW_LOG_MAX_JOURNAL_BYTES) {
		return undefined;
	}
	if (
		!value.every(
			(item) =>
				typeof item === "number" &&
				Number.isInteger(item) &&
				item >= 0 &&
				item <= 255,
		)
	) {
		return undefined;
	}
	return new TextDecoder().decode(Uint8Array.from(value));
}

function envelopeTimestamp(value: unknown): string | undefined {
	const microseconds = text(value);
	if (!microseconds || !/^\d+$/u.test(microseconds)) return undefined;
	const millis = Number(microseconds.slice(0, -3) || microseconds);
	if (!Number.isSafeInteger(millis)) return undefined;
	return new Date(millis).toISOString();
}

function timestamp(value: unknown, fallback?: unknown): string | undefined {
	const candidate = text(value) || envelopeTimestamp(fallback);
	if (!candidate) return undefined;
	const parsed = Date.parse(candidate);
	return Number.isNaN(parsed) ? undefined : new Date(parsed).toISOString();
}

function directionForField(field: string): RawLogDirection {
	return field === "providerRequestBodyText" ? "request" : "response";
}

function chunkFromMessage(
	message: JsonObject,
	unit: string,
	journalTimestamp: unknown,
	field: "providerRequestBodyText" | "providerResponseBodyText",
): RawChunk | undefined {
	const bodyText = message[field];
	if (typeof bodyText !== "string") return undefined;
	const direction = directionForField(field);
	const encodingValue = message[`${field}Encoding`];
	const bodyEncoding =
		encodingValue === "json-string-v1" ? encodingValue : "plain";
	const hasChunkMetadata =
		message[`${field}ChunkIndex`] !== undefined ||
		message[`${field}ChunkCount`] !== undefined;
	const declaredChunkCount = number(message[`${field}ChunkCount`]);
	const declaredChunkIndex = number(message[`${field}ChunkIndex`]);
	if (
		hasChunkMetadata &&
		(declaredChunkCount === undefined ||
			declaredChunkIndex === undefined ||
			!Number.isSafeInteger(declaredChunkCount) ||
			!Number.isSafeInteger(declaredChunkIndex) ||
			declaredChunkCount < 1 ||
			declaredChunkIndex < 0)
	) {
		return undefined;
	}
	const event = text(message.event);
	const currentTimestamp = timestamp(message.time, journalTimestamp);
	if (!event || !currentTimestamp) return undefined;
	const chunkCount = hasChunkMetadata ? declaredChunkCount : 1;
	const chunkIndex = hasChunkMetadata ? declaredChunkIndex : 0;
	if (chunkCount === undefined || chunkIndex === undefined) return undefined;
	if (chunkCount > 10_000 || chunkIndex >= chunkCount) return undefined;
	const provider = text(message.provider);
	const operation = text(message.operation) || text(message.providerOperation);
	const traceId = text(message.traceId);
	const requestId = text(message.requestId);
	const providerRequestId = text(message.providerRequestId);
	const method = text(message.method);
	const statusCode = number(message.providerStatusCode);
	const url = text(message.providerRequestUrl);
	const headersText = text(
		message[
			direction === "request"
				? "providerRequestHeadersText"
				: "providerResponseHeadersText"
		],
	);
	const bodyByteLength = number(message[`${field}ByteLength`]);
	const encodedByteLength = number(message[`${field}EncodedByteLength`]);
	const bodySha256 = text(message[`${field}Sha256`]);
	return {
		timestamp: currentTimestamp,
		unit,
		event,
		direction,
		...(provider ? { provider } : {}),
		...(operation ? { operation } : {}),
		...(traceId ? { traceId } : {}),
		...(requestId ? { requestId } : {}),
		...(providerRequestId ? { providerRequestId } : {}),
		...(method ? { method } : {}),
		...(statusCode !== undefined ? { statusCode } : {}),
		...(url ? { url } : {}),
		...(headersText ? { headersText } : {}),
		bodyText,
		bodyEncoding,
		chunkIndex,
		chunkCount,
		...(bodyByteLength !== undefined ? { bodyByteLength } : {}),
		...(encodedByteLength !== undefined ? { encodedByteLength } : {}),
		...(bodySha256 ? { bodySha256 } : {}),
	};
}

/** 解析 journald -o json；MESSAGE 兼容字符串和 UTF-8 数字数组。 */
export function parseJournalRawChunks(serialized: string): RawChunk[] {
	const chunks: RawChunk[] = [];
	for (const line of serialized.split(/\r?\n/u)) {
		if (!line) continue;
		let envelope: JsonObject;
		try {
			const parsed = JSON.parse(line) as unknown;
			if (!isObject(parsed)) continue;
			envelope = parsed;
		} catch {
			continue;
		}
		const messageText = decodeJournalMessage(envelope.MESSAGE);
		if (!messageText) continue;
		let message: JsonObject;
		try {
			const parsed = JSON.parse(messageText) as unknown;
			if (!isObject(parsed)) continue;
			message = parsed;
		} catch {
			continue;
		}
		const event = text(message.event);
		if (!event?.endsWith(RAW_EVENT_SUFFIX)) continue;
		const unit = text(envelope._SYSTEMD_UNIT) || "unknown";
		for (const field of [
			"providerRequestBodyText",
			"providerResponseBodyText",
		] as const) {
			const chunk = chunkFromMessage(
				message,
				unit,
				envelope.__REALTIME_TIMESTAMP,
				field,
			);
			if (chunk) chunks.push(chunk);
		}
	}
	return chunks;
}

function shortSha256(value: string): string {
	return createHash("sha256").update(value).digest("hex").slice(0, 16);
}

function groupKey(chunk: RawChunk): string {
	return [
		chunk.unit,
		chunk.direction,
		chunk.event,
		chunk.traceId || "",
		chunk.requestId || "",
		chunk.providerRequestId || "",
		chunk.provider || "",
		chunk.operation || "",
	].join("\u0001");
}

function identifierMatches(chunk: RawChunk, identifiers: Set<string>): boolean {
	return [chunk.traceId, chunk.requestId, chunk.providerRequestId].some(
		(value) => value !== undefined && identifiers.has(value),
	);
}

function reconstruct(chunks: RawChunk[]): RawLogEntry {
	const ordered = [...chunks].sort((left, right) => {
		if (left.chunkIndex !== right.chunkIndex)
			return left.chunkIndex - right.chunkIndex;
		return left.timestamp.localeCompare(right.timestamp);
	});
	const first = ordered[0];
	if (!first) {
		throw new Error("raw-log-empty-group");
	}
	const expectedCount = first.chunkCount;
	const indexes = ordered.map((chunk) => chunk.chunkIndex);
	const missingChunkIndexes: number[] = [];
	for (let index = 0; index < expectedCount; index += 1) {
		if (!indexes.includes(index)) missingChunkIndexes.push(index);
	}
	const duplicateIndex = new Set(indexes).size !== indexes.length;
	const sameMetadata = ordered.every(
		(chunk) =>
			chunk.chunkCount === expectedCount &&
			chunk.bodyEncoding === first.bodyEncoding &&
			chunk.bodyByteLength === first.bodyByteLength &&
			chunk.bodySha256 === first.bodySha256,
	);
	const base: RawLogEntry = {
		timestamp: first.timestamp,
		unit: first.unit,
		event: first.event,
		direction: first.direction,
		...(first.provider ? { provider: first.provider } : {}),
		...(first.operation ? { operation: first.operation } : {}),
		...(first.traceId ? { traceId: first.traceId } : {}),
		...(first.requestId ? { requestId: first.requestId } : {}),
		...(first.providerRequestId
			? { providerRequestId: first.providerRequestId }
			: {}),
		...(first.method ? { method: first.method } : {}),
		...(first.statusCode !== undefined ? { statusCode: first.statusCode } : {}),
		...(first.url ? { url: first.url } : {}),
		...(first.headersText ? { headersText: first.headersText } : {}),
		bodyEncoding: first.bodyEncoding,
		chunkCount: expectedCount,
		complete: false,
		...(missingChunkIndexes.length > 0 ? { missingChunkIndexes } : {}),
	};
	if (
		missingChunkIndexes.length > 0 ||
		duplicateIndex ||
		indexes.length !== expectedCount ||
		!sameMetadata
	) {
		return {
			...base,
			error: duplicateIndex
				? "duplicate-chunk-index"
				: missingChunkIndexes.length > 0
					? "missing-chunk"
					: "chunk-metadata-mismatch",
		};
	}
	const encodedBody = ordered.map((chunk) => chunk.bodyText).join("");
	let bodyText: string;
	try {
		if (first.bodyEncoding === "json-string-v1") {
			const decoded = JSON.parse(encodedBody) as unknown;
			if (typeof decoded !== "string")
				throw new Error("decoded-body-not-string");
			bodyText = decoded;
		} else {
			bodyText = encodedBody;
		}
	} catch {
		return { ...base, error: "body-decode-failed" };
	}
	const actualByteLength = new TextEncoder().encode(bodyText).byteLength;
	const actualEncodedByteLength = new TextEncoder().encode(
		encodedBody,
	).byteLength;
	const actualSha256 = shortSha256(bodyText);
	const byteLengthMatches =
		first.bodyByteLength === undefined ||
		first.bodyByteLength === actualByteLength;
	const encodedLengthMatches =
		first.encodedByteLength === undefined ||
		first.encodedByteLength === actualEncodedByteLength;
	const shaMatches =
		first.bodySha256 === undefined || first.bodySha256 === actualSha256;
	const tooLarge = actualByteLength > RAW_LOG_MAX_BODY_BYTES;
	const integrity = {
		...(first.bodyByteLength !== undefined
			? { expectedByteLength: first.bodyByteLength }
			: {}),
		actualByteLength,
		...(first.bodySha256 ? { expectedSha256: first.bodySha256 } : {}),
		actualSha256,
	};
	if (!byteLengthMatches || !encodedLengthMatches || !shaMatches || tooLarge) {
		return {
			...base,
			integrity,
			error: tooLarge ? "body-too-large" : "body-integrity-mismatch",
		};
	}
	return {
		...base,
		complete: true,
		integrity,
		bodyText,
	};
}

function escapedRegexLiteral(value: string): string {
	return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}

async function defaultJournalCommand(args: readonly string[]): Promise<string> {
	const process = Bun.spawn(["journalctl", ...args], {
		stdout: "pipe",
		stderr: "pipe",
	});
	try {
		const output = await new Response(process.stdout).text();
		const exitCode = await process.exited;
		if (exitCode !== 0) throw new Error("journalctl-failed");
		if (
			new TextEncoder().encode(output).byteLength > RAW_LOG_MAX_JOURNAL_BYTES
		) {
			throw new Error("journal-output-too-large");
		}
		return output;
	} catch (error) {
		try {
			process.kill();
		} catch {
			// 已结束的进程无需再次终止。
		}
		throw error;
	}
}

/**
 * 从 API/Worker journald 还原与指定链路相关的原始请求/响应。
 * 运行时始终使用 --all -o json，并在服务端完成 chunk、字节数和摘要校验。
 */
export async function readRawLogTrace(
	query: RawLogTraceQuery,
	journalCommand: JournalCommand = defaultJournalCommand,
): Promise<RawLogTrace> {
	const identifiers = [
		...new Set(query.identifiers.map((value) => value.trim())),
	].filter((value) => value.length > 0);
	if (identifiers.length === 0) throw new Error("raw-log-identifier-required");
	const since = new Date(query.since);
	const until = new Date(query.until);
	if (Number.isNaN(since.getTime()) || Number.isNaN(until.getTime())) {
		throw new Error("raw-log-window-invalid");
	}
	if (until.getTime() < since.getTime())
		throw new Error("raw-log-window-invalid");
	const maxEntries = Math.min(
		RAW_LOG_MAX_ENTRIES,
		Math.max(1, Math.trunc(query.maxEntries ?? RAW_LOG_MAX_ENTRIES)),
	);
	const grep = identifiers.map(escapedRegexLiteral).join("|");
	const args = [
		"--all",
		"-o",
		"json",
		"--no-pager",
		"-u",
		RAW_LOG_UNITS[0],
		"-u",
		RAW_LOG_UNITS[1],
		"--since",
		formatJournalTimestamp(since),
		"--until",
		formatJournalTimestamp(until),
		"--grep",
		grep,
	] as const;
	const serialized = await journalCommand(args);
	const chunks = parseJournalRawChunks(serialized).filter((chunk) =>
		identifierMatches(chunk, new Set(identifiers)),
	);
	const groups = new Map<string, RawChunk[]>();
	for (const chunk of chunks) {
		const key = groupKey(chunk);
		const current = groups.get(key);
		if (current) current.push(chunk);
		else groups.set(key, [chunk]);
	}
	const entries = [...groups.values()]
		.map(reconstruct)
		.sort((left, right) => left.timestamp.localeCompare(right.timestamp));
	return {
		entries: entries.slice(0, maxEntries),
		total: entries.length,
		truncated: entries.length > maxEntries,
		maxEntries,
		identifiers,
		since: since.toISOString(),
		until: until.toISOString(),
		matchedJournalRecords: chunks.length,
	};
}
