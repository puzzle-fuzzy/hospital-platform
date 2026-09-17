import { createHash } from "node:crypto";
import { pairRawLogInvocations } from "./raw-log-invocations";
import { parseRawLogEntriesFromSerialized } from "./raw-logs";
import type { RawLogEntry } from "./types";

export const PAYMENT_BOUNDARY_BUFFER_MS = 30 * 60 * 1_000;
export const PAYMENT_MAX_JOURNAL_BYTES = 64 * 1024 * 1024;
export const PAYMENT_MAX_ORDERS = 300;
export const PAYMENT_MAX_INTERFACES = 300;

const ORDER_PAYMENT_EVENT =
	/^(?:medical-insurance\.(?:authorization\.(?:requested|completed)|fees\.|settlement\.|wechat-mix\.|pre-payment-component\.|(?:\d|plugin\.)|cancellation\.|reauthorization\.)|payment\.wechat_prepay\.|outpatient\.self-payment\.|appointment\.self-payment\.|worker\.payment\.(?:medical|wechat))/u;
const ORDER_SEED_EVENTS = new Set([
	"medical-insurance.authorization.requested",
	"medical-insurance.wechat-mix.requested",
	"payment.wechat_prepay.requested",
	"payment.wechat_prepay.created",
	"payment.wechat_prepay.failed",
	"outpatient.self-payment.requested",
	"outpatient.self-payment.provider-settlement-succeeded",
	"appointment.self-payment.2.27.2.29.persisted",
	"medical-insurance.plugin.2.27.2.29.persisted",
]);

type JsonObject = Record<string, unknown>;

export type PaymentJournalRecord = {
	line: string;
	envelope: JsonObject;
	message: JsonObject;
	time: string;
	unit: string;
};

export type PaymentDayWindow = {
	date: string;
	start: Date;
	endExclusive: Date;
	readSince: Date;
	readUntil: Date;
};

export type PaymentOrder = {
	orderId: string;
	appointmentId?: string;
	startedAt: string;
	records: PaymentJournalRecord[];
	identifiers: Set<string>;
};

type Attribution = "correlation" | "timeline";
type PaymentBoundary = "before-day" | "within-day" | "after-day";
export type PaymentStatus =
	| "CANCELLED"
	| "MANUAL_REVIEW_REQUIRED"
	| "PROVIDER_COMPLETED"
	| "OBSERVED"
	| "INCOMPLETE";

export type PaymentInterfaceSummary = {
	id: string;
	ordinal: number;
	operation?: string;
	displayOperation: string;
	invocationIndex: number;
	timestamp: string;
	traceId?: string;
	providerRequestId?: string;
	statusCode?: number;
	complete: boolean;
	attribution: Attribution;
	boundary: PaymentBoundary;
};

export type PaymentFlowSummary = {
	id: string;
	orderId: string;
	appointmentId?: string;
	startedAt: string;
	status: PaymentStatus;
	interfaceCount: number;
	completeInterfaceCount: number;
	hasBoundaryCrossing: boolean;
	attributionWarningCount: number;
	interfaces: PaymentInterfaceSummary[];
};

export type PaymentDayResult = {
	date: string;
	timezone: "Asia/Shanghai";
	window: {
		start: string;
		endExclusive: string;
		readSince: string;
		readUntil: string;
		boundaryBufferMinutes: number;
	};
	orders: PaymentFlowSummary[];
	parsedRecords: number;
	unmatchedPaymentEventCount: number;
};

export type PaymentInterfaceDetail = {
	flowId: string;
	orderId: string;
	appointmentId?: string;
	startedAt: string;
	status: PaymentStatus;
	interface: PaymentInterfaceSummary;
	request?: RawLogEntry;
	response?: RawLogEntry;
};

type InternalPaymentInterface = PaymentInterfaceSummary & {
	request?: RawLogEntry;
	response?: RawLogEntry;
};

type InternalPaymentFlow = Omit<PaymentFlowSummary, "interfaces"> & {
	interfaces: InternalPaymentInterface[];
};

export type PaymentDaySnapshot = Omit<PaymentDayResult, "orders"> & {
	orders: InternalPaymentFlow[];
};

function isObject(value: unknown): value is JsonObject {
	return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function stringValue(value: unknown): string | undefined {
	return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function recordTime(
	message: JsonObject,
	envelope: JsonObject,
): string | undefined {
	const messageTime = stringValue(message.time);
	if (messageTime && !Number.isNaN(Date.parse(messageTime))) {
		return new Date(messageTime).toISOString();
	}
	const raw = envelope.__REALTIME_TIMESTAMP;
	const rawText =
		typeof raw === "number" && Number.isSafeInteger(raw)
			? String(raw)
			: stringValue(raw);
	if (!rawText || !/^\d+$/u.test(rawText)) return undefined;
	const millis = Number(rawText.slice(0, -3) || rawText);
	return Number.isSafeInteger(millis)
		? new Date(millis).toISOString()
		: undefined;
}

function decodeMessage(value: unknown): string | undefined {
	if (typeof value === "string") return value;
	if (!Array.isArray(value) || value.length > PAYMENT_MAX_JOURNAL_BYTES) {
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
	try {
		return new TextDecoder("utf-8", { fatal: true }).decode(
			Uint8Array.from(value),
		);
	} catch {
		return undefined;
	}
}

export function parsePaymentJournal(
	serialized: string,
): PaymentJournalRecord[] {
	const records: PaymentJournalRecord[] = [];
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
		const messageText = decodeMessage(envelope.MESSAGE);
		if (!messageText) continue;
		let message: JsonObject;
		try {
			const parsed = JSON.parse(messageText) as unknown;
			if (!isObject(parsed)) continue;
			message = parsed;
		} catch {
			continue;
		}
		const time = recordTime(message, envelope);
		if (!time || !stringValue(message.event)) continue;
		records.push({
			line,
			envelope,
			message,
			time,
			unit: stringValue(envelope._SYSTEMD_UNIT) || "unknown",
		});
	}
	return records.sort((left, right) => left.time.localeCompare(right.time));
}

function addIdentifier(set: Set<string>, value: unknown): void {
	const normalized = stringValue(value);
	if (normalized && normalized.length <= 512) set.add(normalized);
}

function orderSeed(record: PaymentJournalRecord): string | undefined {
	const orderId = stringValue(record.message.orderId);
	const event = stringValue(record.message.event);
	return orderId &&
		event &&
		(ORDER_SEED_EVENTS.has(event) || ORDER_PAYMENT_EVENT.test(event))
		? orderId
		: undefined;
}

function createOrder(
	record: PaymentJournalRecord,
	orderId: string,
): PaymentOrder {
	const order: PaymentOrder = {
		orderId,
		startedAt: record.time,
		records: [],
		identifiers: new Set([orderId]),
	};
	const appointmentId = stringValue(record.message.appointmentId);
	if (appointmentId) order.appointmentId = appointmentId;
	return order;
}

function addRecord(order: PaymentOrder, record: PaymentJournalRecord): void {
	order.records.push(record);
	if (!order.appointmentId) {
		const appointmentId = stringValue(record.message.appointmentId);
		if (appointmentId) order.appointmentId = appointmentId;
	}
	addIdentifier(order.identifiers, record.message.traceId);
	addIdentifier(order.identifiers, record.message.requestId);
	addIdentifier(order.identifiers, record.message.providerRequestId);
	addIdentifier(order.identifiers, record.message.taskId);
	if (Array.isArray(record.message.providerRequestIds)) {
		for (const value of record.message.providerRequestIds) {
			addIdentifier(order.identifiers, value);
		}
	}
}

function cancellationTime(order: PaymentOrder): number {
	return Math.max(
		...order.records
			.filter((record) =>
				/\.cancellation(?:\.2\.6\.65\.6)?\.completed$/u.test(
					stringValue(record.message.event) || "",
				),
			)
			.map((record) => Date.parse(record.time)),
	);
}

function selectTimelineOrder(
	candidates: PaymentOrder[],
	recordTimeMillis: number,
): PaymentOrder | undefined {
	const timeline = [...candidates].sort((left, right) =>
		left.startedAt.localeCompare(right.startedAt),
	);
	let selected: PaymentOrder | undefined;
	for (let index = 0; index < timeline.length; index += 1) {
		const current = timeline[index];
		if (!current) continue;
		const next = timeline[index + 1];
		const nextStart = next
			? Date.parse(next.startedAt)
			: Number.POSITIVE_INFINITY;
		if (
			recordTimeMillis >= Date.parse(current.startedAt) &&
			recordTimeMillis < nextStart
		) {
			selected = current;
			break;
		}
	}
	for (let index = 1; index < timeline.length; index += 1) {
		const previous = timeline[index - 1];
		const current = timeline[index];
		if (!previous || !current) continue;
		const cancelledAt = cancellationTime(previous);
		if (
			Number.isFinite(cancelledAt) &&
			recordTimeMillis >= cancelledAt &&
			recordTimeMillis < Date.parse(current.startedAt)
		) {
			selected = current;
		}
	}
	return selected;
}

export function collectPaymentOrders(
	records: PaymentJournalRecord[],
): PaymentOrder[] {
	const orders = new Map<string, PaymentOrder>();
	for (const record of records) {
		const seed = orderSeed(record);
		if (seed && !orders.has(seed)) orders.set(seed, createOrder(record, seed));
	}
	const ordered = [...orders.values()].sort((left, right) =>
		left.startedAt.localeCompare(right.startedAt),
	);
	for (const record of records) {
		const orderId =
			stringValue(record.message.orderId) || stringValue(record.message.taskId);
		const explicit = orderId
			? ordered.find((order) => order.orderId === orderId)
			: undefined;
		if (explicit) addRecord(explicit, record);
	}
	for (const record of records) {
		const orderId =
			stringValue(record.message.orderId) || stringValue(record.message.taskId);
		if (orderId && ordered.some((order) => order.orderId === orderId)) continue;
		const appointmentId =
			stringValue(record.message.appointmentId) ||
			stringValue(record.message.businessId);
		if (!appointmentId) continue;
		const candidates = ordered.filter(
			(order) => order.appointmentId === appointmentId,
		);
		if (candidates.length === 0) continue;
		const selected =
			candidates.length === 1
				? candidates[0]
				: selectTimelineOrder(candidates, Date.parse(record.time));
		if (selected) addRecord(selected, record);
	}
	for (const order of ordered) {
		order.records.sort((left, right) => left.time.localeCompare(right.time));
	}
	return ordered;
}

export function paymentDayWindow(date: string): PaymentDayWindow {
	if (!/^\d{4}-\d{2}-\d{2}$/u.test(date)) {
		throw new Error("payment-day-date-invalid");
	}
	const start = new Date(`${date}T00:00:00+08:00`);
	if (Number.isNaN(start.getTime()))
		throw new Error("payment-day-date-invalid");
	const formatted = new Intl.DateTimeFormat("en-CA", {
		timeZone: "Asia/Shanghai",
		year: "numeric",
		month: "2-digit",
		day: "2-digit",
	}).format(start);
	if (formatted !== date) throw new Error("payment-day-date-invalid");
	const endExclusive = new Date(start.getTime() + 24 * 60 * 60 * 1_000);
	return {
		date,
		start,
		endExclusive,
		readSince: new Date(start.getTime() - PAYMENT_BOUNDARY_BUFFER_MS),
		readUntil: new Date(endExclusive.getTime() + PAYMENT_BOUNDARY_BUFFER_MS),
	};
}

function paymentFlowId(date: string, orderId: string): string {
	return `payment-${createHash("sha256")
		.update(`${date}\u0000${orderId}`)
		.digest("hex")
		.slice(0, 24)}`;
}

function displayOperation(operation: string | undefined): string {
	if (!operation) return "支付接口";
	const code = operation.match(/(?:^|\.)(2(?:\.\d+){2,4}|\d{4})(?:\.|$)/u)?.[1];
	if (code) return code;
	const readable: Record<string, string> = {
		"outpatient-payment-context": "支付上下文",
		"appointment-patient-profile": "就诊人信息",
		"appointment-patient-archive": "就诊人档案",
		"appointment-active-records": "预约记录",
		"appointment-registration-create": "挂号创建",
		"appointment-cancellation": "预约取消",
		"medical-insurance.authorization.user-query": "医保授权查询",
		"medical-mix-create": "混合支付下单",
		"medical-mix-query": "混合支付查单",
		"medical-mix-query-by-out-trade-no": "混合支付按外部订单查单",
	};
	return readable[operation] || operation;
}

function boundaryFor(
	timestamp: string,
	window: PaymentDayWindow,
): PaymentBoundary {
	const value = Date.parse(timestamp);
	if (value < window.start.getTime()) return "before-day";
	if (value >= window.endExclusive.getTime()) return "after-day";
	return "within-day";
}

function hasIdentifier(entry: RawLogEntry, order: PaymentOrder): boolean {
	return [entry.traceId, entry.requestId, entry.providerRequestId].some(
		(value) => value !== undefined && order.identifiers.has(value),
	);
}

function hasAnyIdentifier(
	entry: RawLogEntry,
	identifiers: Set<string>,
): boolean {
	return [entry.traceId, entry.requestId, entry.providerRequestId].some(
		(value) => value !== undefined && identifiers.has(value),
	);
}

function assignRawEntries(
	entries: RawLogEntry[],
	order: PaymentOrder,
	allOrders: PaymentOrder[],
): {
	entries: RawLogEntry[];
	reasons: Map<RawLogEntry, Attribution>;
	warningCount: number;
} {
	const reasons = new Map<RawLogEntry, Attribution>();
	const selected: RawLogEntry[] = [];
	let warningCount = 0;
	for (const entry of entries) {
		const correlated = allOrders.filter((candidate) =>
			hasIdentifier(entry, candidate),
		);
		if (correlated.length === 1) {
			if (correlated[0] === order) {
				selected.push(entry);
				reasons.set(entry, "correlation");
			}
			continue;
		}
		const entryTime = Date.parse(entry.timestamp);
		const timelineCandidates = correlated.length > 1 ? correlated : allOrders;
		const timelineOrder = selectTimelineOrder(timelineCandidates, entryTime);
		if (timelineOrder === order) {
			selected.push(entry);
			reasons.set(entry, "timeline");
			continue;
		}
		if (correlated.length > 1 || !timelineOrder) warningCount += 1;
	}
	return { entries: selected, reasons, warningCount };
}

function statusForOrder(
	order: PaymentOrder,
	interfaces: InternalPaymentInterface[],
): PaymentStatus {
	const events = new Set(
		order.records.map((record) => stringValue(record.message.event)),
	);
	if (
		events.has("medical-insurance.reauthorization.cancellation.completed") ||
		events.has("medical-insurance.cancellation.completed")
	)
		return "CANCELLED";
	if (
		events.has("worker.payment.medical_order_query.manual_review_required") ||
		events.has("worker.payment.medical_wechat_query.manual_review_required")
	)
		return "MANUAL_REVIEW_REQUIRED";
	if (
		events.has("medical-insurance.2.27.2.32.completed") ||
		events.has("medical-insurance.2.6.65.5.completed")
	)
		return "PROVIDER_COMPLETED";
	if (interfaces.some((item) => item.request && item.response))
		return "OBSERVED";
	return "INCOMPLETE";
}

function buildInternalFlow(
	order: PaymentOrder,
	allOrders: PaymentOrder[],
	window: PaymentDayWindow,
	rawEntries: RawLogEntry[],
): InternalPaymentFlow {
	const assigned = assignRawEntries(rawEntries, order, allOrders);
	const entries = assigned.entries.slice(0, PAYMENT_MAX_INTERFACES);
	const invocations = pairRawLogInvocations({
		entries,
		total: assigned.entries.length,
		truncated: assigned.entries.length > entries.length,
		maxEntries: PAYMENT_MAX_INTERFACES,
		identifiers: [...order.identifiers],
		since: window.readSince.toISOString(),
		until: window.readUntil.toISOString(),
		matchedJournalRecords: entries.length,
	});
	const primary = invocations.filter(
		(invocation) => invocation.layer === "transport",
	);
	const interfaces: InternalPaymentInterface[] = primary
		.slice(0, PAYMENT_MAX_INTERFACES)
		.map((invocation, index) => {
			const timestamp =
				invocation.request?.timestamp ||
				invocation.response?.timestamp ||
				order.startedAt;
			const attribution =
				assigned.reasons.get(invocation.request as RawLogEntry) ||
				assigned.reasons.get(invocation.response as RawLogEntry) ||
				"correlation";
			return {
				id: `${paymentFlowId(window.date, order.orderId)}-interface-${index + 1}`,
				ordinal: index + 1,
				...(invocation.operation ? { operation: invocation.operation } : {}),
				displayOperation: displayOperation(invocation.operation),
				invocationIndex: invocation.attempt,
				timestamp,
				...(invocation.traceId ? { traceId: invocation.traceId } : {}),
				...(invocation.providerRequestId
					? { providerRequestId: invocation.providerRequestId }
					: {}),
				...(invocation.request?.statusCode !== undefined
					? { statusCode: invocation.request.statusCode }
					: invocation.response?.statusCode !== undefined
						? { statusCode: invocation.response.statusCode }
						: {}),
				complete: Boolean(
					invocation.request?.complete && invocation.response?.complete,
				),
				attribution,
				boundary: boundaryFor(timestamp, window),
				...(invocation.request ? { request: invocation.request } : {}),
				...(invocation.response ? { response: invocation.response } : {}),
			};
		});
	const hasBoundaryCrossing = interfaces.some(
		(item) => item.boundary !== "within-day",
	);
	return {
		id: paymentFlowId(window.date, order.orderId),
		orderId: order.orderId,
		...(order.appointmentId ? { appointmentId: order.appointmentId } : {}),
		startedAt: order.startedAt,
		status: statusForOrder(order, interfaces),
		interfaceCount: interfaces.length,
		completeInterfaceCount: interfaces.filter((item) => item.complete).length,
		hasBoundaryCrossing,
		attributionWarningCount: assigned.warningCount,
		interfaces,
	};
}

export function buildPaymentDaySnapshot(
	date: string,
	serialized: string,
): PaymentDaySnapshot {
	const window = paymentDayWindow(date);
	if (
		new TextEncoder().encode(serialized).byteLength > PAYMENT_MAX_JOURNAL_BYTES
	) {
		throw new Error("payment-day-journal-too-large");
	}
	const records = parsePaymentJournal(serialized);
	const allOrders = collectPaymentOrders(records);
	const allIdentifiers = new Set(
		allOrders.flatMap((order) => [...order.identifiers]),
	);
	const rawEntries = parseRawLogEntriesFromSerialized(serialized).filter(
		(entry) => hasAnyIdentifier(entry, allIdentifiers),
	);
	const orders = allOrders
		.filter((order) => {
			const started = Date.parse(order.startedAt);
			return (
				started >= window.start.getTime() &&
				started < window.endExclusive.getTime()
			);
		})
		.slice(0, PAYMENT_MAX_ORDERS)
		.map((order) => buildInternalFlow(order, allOrders, window, rawEntries));
	const unmatchedPaymentEventCount = records.filter(
		(record) =>
			ORDER_PAYMENT_EVENT.test(stringValue(record.message.event) || "") &&
			!stringValue(record.message.orderId),
	).length;
	return {
		date,
		timezone: "Asia/Shanghai",
		window: {
			start: window.start.toISOString(),
			endExclusive: window.endExclusive.toISOString(),
			readSince: window.readSince.toISOString(),
			readUntil: window.readUntil.toISOString(),
			boundaryBufferMinutes: PAYMENT_BOUNDARY_BUFFER_MS / 60_000,
		},
		orders,
		parsedRecords: records.length,
		unmatchedPaymentEventCount,
	};
}

export function publicPaymentDay(
	snapshot: PaymentDaySnapshot,
): PaymentDayResult {
	return {
		...snapshot,
		orders: snapshot.orders.map((order) => ({
			...order,
			interfaces: order.interfaces.map(
				({ request: _request, response: _response, ...summary }) => summary,
			),
		})),
	};
}

export function paymentInterfaceDetail(
	snapshot: PaymentDaySnapshot,
	flowId: string,
	ordinal: number,
): PaymentInterfaceDetail | undefined {
	const flow = snapshot.orders.find((item) => item.id === flowId);
	const interfaceItem = flow?.interfaces.find(
		(item) => item.ordinal === ordinal,
	);
	if (!flow || !interfaceItem) return undefined;
	const { request, response, ...summary } = interfaceItem;
	return {
		flowId: flow.id,
		orderId: flow.orderId,
		...(flow.appointmentId ? { appointmentId: flow.appointmentId } : {}),
		startedAt: flow.startedAt,
		status: flow.status,
		interface: summary,
		...(request ? { request } : {}),
		...(response ? { response } : {}),
	};
}
