import type { RawLogEntry, RawLogTrace } from "./types";

export type RawLogLayer = "transport" | "logical" | "legacy" | "other";

export type RawLogInvocation = {
	key: string;
	layer: RawLogLayer;
	operation?: string;
	provider?: string;
	traceId?: string;
	requestId?: string;
	providerRequestId?: string;
	attempt: number;
	request?: RawLogEntry;
	response?: RawLogEntry;
	complete: boolean;
};

type InvocationGroup = {
	layer: RawLogLayer;
	operation?: string;
	provider?: string;
	traceId?: string;
	requestId?: string;
	providerRequestId?: string;
	requests: RawLogEntry[];
	responses: RawLogEntry[];
};

function rawLayer(event: string): RawLogLayer {
	if (event === "provider.request.raw" || event === "provider.response.raw") {
		return "transport";
	}
	if (
		event === "provider.request.logical.raw" ||
		event === "provider.response.logical.raw"
	) {
		return "logical";
	}
	if (event === "medical-insurance.legacy-fsi.response.raw") return "legacy";
	return "other";
}

function correlationId(entry: RawLogEntry): string | undefined {
	return entry.traceId || entry.providerRequestId || entry.requestId;
}

function groupKey(entry: RawLogEntry, index: number): string {
	return [
		rawLayer(entry.event),
		correlationId(entry) || `unidentified:${entry.timestamp}:${index}`,
		entry.operation || entry.event,
		entry.provider || "",
	].join("\u0001");
}

/**
 * 把受控 raw trace 按“实际调用”配对成独立的 request/response。
 *
 * 同一 trace/operation 可能连续出现多次调用；请求和返回按时间排序后按
 * 序号配对，避免把重试合并成一条。transport、logical、legacy 也保持分层，
 * 便于管理端看清哪一层缺了入参或返回。
 */
export function pairRawLogInvocations(trace: RawLogTrace): RawLogInvocation[] {
	const groups = new Map<string, InvocationGroup>();
	for (const [index, entry] of trace.entries.entries()) {
		const key = groupKey(entry, index);
		let current = groups.get(key);
		if (!current) {
			current = {
				layer: rawLayer(entry.event),
				...(entry.operation || entry.event
					? { operation: entry.operation || entry.event }
					: {}),
				...(entry.provider ? { provider: entry.provider } : {}),
				...(entry.traceId ? { traceId: entry.traceId } : {}),
				...(entry.requestId ? { requestId: entry.requestId } : {}),
				...(entry.providerRequestId
					? { providerRequestId: entry.providerRequestId }
					: {}),
				requests: [],
				responses: [],
			};
			groups.set(key, current);
		}
		if (entry.direction === "request") current.requests.push(entry);
		else current.responses.push(entry);
		if (entry.traceId && !current.traceId) current.traceId = entry.traceId;
		if (entry.requestId && !current.requestId) {
			current.requestId = entry.requestId;
		}
		if (entry.providerRequestId && !current.providerRequestId) {
			current.providerRequestId = entry.providerRequestId;
		}
	}

	const invocations: RawLogInvocation[] = [];
	for (const [groupIndex, group] of [...groups.values()].entries()) {
		group.requests.sort((left, right) =>
			left.timestamp.localeCompare(right.timestamp),
		);
		group.responses.sort((left, right) =>
			left.timestamp.localeCompare(right.timestamp),
		);
		const count = Math.max(group.requests.length, group.responses.length, 1);
		for (let attempt = 0; attempt < count; attempt += 1) {
			const request = group.requests[attempt];
			const response = group.responses[attempt];
			const traceId = request?.traceId || response?.traceId || group.traceId;
			const requestId =
				request?.requestId || response?.requestId || group.requestId;
			const providerRequestId =
				request?.providerRequestId ||
				response?.providerRequestId ||
				group.providerRequestId;
			invocations.push({
				key: `${groupIndex}:${attempt}`,
				layer: group.layer,
				...(group.operation ? { operation: group.operation } : {}),
				...(group.provider ? { provider: group.provider } : {}),
				...(traceId === undefined ? {} : { traceId }),
				...(requestId === undefined ? {} : { requestId }),
				...(providerRequestId === undefined ? {} : { providerRequestId }),
				attempt,
				...(request ? { request } : {}),
				...(response ? { response } : {}),
				complete: Boolean(request?.complete && response?.complete),
			});
		}
	}

	return invocations.sort((left, right) => {
		const leftTime = left.request?.timestamp || left.response?.timestamp || "";
		const rightTime =
			right.request?.timestamp || right.response?.timestamp || "";
		return leftTime.localeCompare(rightTime);
	});
}
