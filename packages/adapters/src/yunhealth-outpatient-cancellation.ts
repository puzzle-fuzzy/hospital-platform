import { createHash } from "node:crypto";
import {
	parseJsonPreservingLargeIntegers,
	stringifyJsonPreservingLargeIntegers,
} from "@hospital/contracts";
import {
	type ExternalTrace,
	isBoundedOpaqueIdentifier,
	normalizeAdapterCallContext,
	type OutpatientSelfPayCancellationGateway,
	type RegistrationSelfPaySettlementContext,
} from "@hospital/domain";
import { AdapterNotConfiguredError, ProviderRequestError } from "./errors";
import {
	type ProviderFetcher,
	type ProviderRequestLogger,
	requestJson,
} from "./http";

const QUERY_PATH = "/msun-middle-open-settlepay/api/v2/open/payment/pay-query";
const CANCEL_PATH =
	"/msun-middle-open-settlepay/api/v2/open/settle/cancel-settle";
const QUERY_OPERATION = "outpatient-self-pay.2.6.65.4";
const CANCEL_OPERATION = "outpatient-self-pay.2.6.65.6";
const OPERATION = "outpatient-self-pay.cancellation";
const MAX_LONG = 9_223_372_036_854_775_807n;

export type YunhealthOutpatientSelfPayCancellationGatewayOptions = {
	baseUrl: string;
	authorizationToken?: string;
	hospitalId?: string;
	authSysCode?: string;
	workStationId?: string;
	fetcher?: ProviderFetcher;
	logger?: ProviderRequestLogger;
};

type RecordValue = Record<string, unknown>;
type CancellationReference = {
	businessId: string;
	payingId: string;
	tradingId: string;
	hospitalId: string;
	patientId: string;
};

function record(value: unknown): RecordValue | undefined {
	return typeof value === "object" && value !== null && !Array.isArray(value)
		? (value as RecordValue)
		: undefined;
}

/** References stay exact decimal strings internally and exact Long tokens on wire. */
function positiveLong(value: unknown): string | undefined {
	const raw =
		typeof value === "string"
			? value
			: typeof value === "bigint"
				? String(value)
				: typeof value === "number" && Number.isSafeInteger(value)
					? String(value)
					: "";
	if (!/^[1-9]\d{0,18}$/u.test(raw)) return undefined;
	return BigInt(raw) <= MAX_LONG ? raw : undefined;
}

function invalidReference(): never {
	throw new ProviderRequestError({
		provider: "yunhealth",
		operation: OPERATION,
		message: "Outpatient cancellation context is invalid",
		retryable: false,
		failureStage: "validation",
		requestOutcome: "not_sent",
	});
}

function reference(
	value: RegistrationSelfPaySettlementContext,
	orderId: string,
	configuredHospitalId: string | undefined,
	workStationId: string,
): CancellationReference {
	const saved = record(value);
	if (
		saved?.tradeTypeCode !== "2" ||
		saved.payTypeId !== "5032" ||
		saved.workStationId !== workStationId ||
		(saved.platformOrderId !== undefined && saved.platformOrderId !== orderId)
	)
		return invalidReference();
	const businessId = positiveLong(saved.businessId);
	const payingId = positiveLong(saved.payingId);
	const tradingId = positiveLong(saved.tradingId);
	const hospitalId = positiveLong(saved.hospitalId);
	const patientId = positiveLong(saved.patientId);
	if (
		!businessId ||
		!payingId ||
		!tradingId ||
		!hospitalId ||
		!patientId ||
		(configuredHospitalId !== undefined && hospitalId !== configuredHospitalId)
	)
		return invalidReference();
	return { businessId, payingId, tradingId, hospitalId, patientId };
}

function successfulData(
	rawBodyText: string | undefined,
): RecordValue | undefined {
	if (typeof rawBodyText !== "string") return undefined;
	let parsed: unknown;
	try {
		parsed = parseJsonPreservingLargeIntegers(rawBodyText);
	} catch {
		return undefined;
	}
	const envelope = record(parsed);
	if (
		envelope?.success !== true ||
		![0, "0", "0000"].includes(envelope.code as string | number)
	)
		return undefined;
	return record(envelope.data);
}

/** Never select a convenient status from another payment in a response tree. */
function referencesMatch(data: RecordValue, expected: CancellationReference) {
	const entries: RecordValue[] = [data];
	for (const key of ["record", "payRecord"]) {
		if (data[key] === undefined) continue;
		const value = record(data[key]);
		if (!value) return false;
		entries.push(value);
	}
	if (data.payRecords !== undefined) {
		if (!Array.isArray(data.payRecords)) return false;
		for (const value of data.payRecords) {
			const item = record(value);
			if (!item) return false;
			entries.push(item);
		}
	}
	for (const item of entries) {
		for (const [key, value] of Object.entries(expected)) {
			if (item[key] !== undefined && positiveLong(item[key]) !== value)
				return false;
		}
		if (
			(item.patId !== undefined &&
				positiveLong(item.patId) !== expected.patientId) ||
			(item.payTypeId !== undefined && positiveLong(item.payTypeId) !== "5032")
		)
			return false;
	}
	return true;
}

function amountMatches(value: unknown, expectedFen: number): boolean {
	const text = typeof value === "number" ? String(value) : value;
	if (typeof text !== "string" || text.length > 32) return false;
	const parts = /^(0|[1-9]\d*)(?:\.(\d+))?$/u.exec(text);
	if (!parts || /[1-9]/u.test(parts[2]?.slice(2) ?? "")) return false;
	return (
		BigInt(parts[1] ?? "0") * 100n +
			BigInt((parts[2] ?? "").slice(0, 2).padEnd(2, "0")) ===
		BigInt(expectedFen)
	);
}

/**
 * A cashier exit can leave .4 at code=2 with nullable top-level payment fields.
 * This is not proof of failed payment: submit only the bound initiation-stage
 * settlement to HIS, which must independently accept .6 before we cancel it.
 */
function hasBoundInitiatingPayment(
	data: RecordValue,
	expected: CancellationReference,
	totalFen: number,
	context: RegistrationSelfPaySettlementContext,
): boolean {
	if (
		context.outpatientCancellation?.state !== "requested" ||
		data.success !== false ||
		(data.code !== 2 && data.code !== "2") ||
		data.payTypeId !== null ||
		!Array.isArray(data.payRecords) ||
		data.payRecords.length !== 1
	)
		return false;
	const trading = record(data.record);
	if (
		!trading ||
		positiveLong(trading.tradingId) !== expected.tradingId ||
		positiveLong(trading.hospitalId) !== expected.hospitalId ||
		positiveLong(trading.patId) !== expected.patientId ||
		String(trading.tradeTypeCode) !== "2" ||
		positiveLong(trading.tradeStatus) !== "1" ||
		(trading.tradeStatusId !== undefined &&
			positiveLong(trading.tradeStatusId) !== "1") ||
		!amountMatches(trading.tradeAmount, totalFen)
	)
		return false;
	const matches = (value: unknown) => {
		const payment = record(value);
		return (
			payment !== undefined &&
			positiveLong(payment.payingId) === expected.payingId &&
			positiveLong(payment.tradingId) === expected.tradingId &&
			positiveLong(payment.hospitalId) === expected.hospitalId &&
			positiveLong(payment.payTypeId) === "5032" &&
			positiveLong(payment.status) === "1" &&
			positiveLong(payment.payingType) === "1" &&
			(payment.refundTimes === 0 || payment.refundTimes === "0") &&
			(payment.relationPayingId === 0 || payment.relationPayingId === "0") &&
			(payment.invalidFlag === 0 || payment.invalidFlag === "0") &&
			amountMatches(payment.refundAmount, 0) &&
			amountMatches(payment.receiveAmount, totalFen)
		);
	};
	return (
		matches(data.payRecords[0]) &&
		(data.payRecord === null ||
			data.payRecord === undefined ||
			matches(data.payRecord)) &&
		referencesMatch(
			{
				...data,
				payTypeId: undefined,
				payRecord: data.payRecord ?? undefined,
			},
			expected,
		)
	);
}

/** A failed summary must never override contradictory paid/refund details. */
function hasConflictingPaymentEvidence(
	data: RecordValue,
	totalFen: number,
): boolean {
	const trading = record(data.record);
	if (
		trading &&
		((trading.tradeStatus !== undefined &&
			positiveLong(trading.tradeStatus) !== "1") ||
			(trading.tradeStatusId !== undefined &&
				positiveLong(trading.tradeStatusId) !== "1") ||
			(trading.tradeAmount !== undefined &&
				!amountMatches(trading.tradeAmount, totalFen)))
	)
		return true;
	const payments = [
		data.payRecord,
		...(Array.isArray(data.payRecords) ? data.payRecords : []),
	];
	return payments.some((value) => {
		const payment = record(value);
		if (!payment) return false;
		return (
			(payment.status !== undefined && positiveLong(payment.status) !== "1") ||
			(payment.payingType !== undefined &&
				positiveLong(payment.payingType) !== "1") ||
			(payment.refundTimes !== undefined &&
				payment.refundTimes !== 0 &&
				payment.refundTimes !== "0") ||
			(payment.refundAmount !== undefined &&
				!amountMatches(payment.refundAmount, 0)) ||
			(payment.relationPayingId !== undefined &&
				payment.relationPayingId !== 0 &&
				payment.relationPayingId !== "0") ||
			(payment.invalidFlag !== undefined &&
				payment.invalidFlag !== 0 &&
				payment.invalidFlag !== "0") ||
			(payment.receiveAmount !== undefined &&
				!amountMatches(payment.receiveAmount, totalFen))
		);
	});
}

function configuredText(value: unknown, allowEmpty = false): string {
	if (
		typeof value !== "string" ||
		value.length > 100 ||
		(!allowEmpty && value.length === 0) ||
		value !== value.trim() ||
		/\p{Cc}/u.test(value)
	)
		throw new AdapterNotConfiguredError("yunhealth");
	return value;
}

/**
 * Explicit cashier cancellation: failed payment, or fully bound code=2 at its
 * initiation stage, may submit .6. Only .6 cancelStatus=1 confirms cancellation.
 * .4 autoSettle=0 cannot finish a settlement while checking cancellation safety.
 * Other unknown states stay pending; .11 can revoke money and is never used.
 */
export function createYunhealthOutpatientSelfPayCancellationGateway(
	options: YunhealthOutpatientSelfPayCancellationGatewayOptions,
): OutpatientSelfPayCancellationGateway {
	let baseUrl: string;
	try {
		const url = new URL(options.baseUrl);
		if (
			url.protocol !== "https:" ||
			url.username ||
			url.password ||
			url.search ||
			url.hash
		)
			throw new Error();
		baseUrl = url.toString().replace(/\/$/u, "");
	} catch {
		throw new AdapterNotConfiguredError("yunhealth");
	}
	const authorization = options.authorizationToken?.trim();
	if (authorization && /[\r\n]/u.test(authorization))
		throw new AdapterNotConfiguredError("yunhealth");
	const authSysCode = configuredText(options.authSysCode ?? "thirdSelfMachine");
	const workStationId = configuredText(options.workStationId ?? "", true);
	const configuredHospitalId =
		options.hospitalId === undefined
			? undefined
			: positiveLong(options.hospitalId);
	if (options.hospitalId !== undefined && !configuredHospitalId)
		throw new AdapterNotConfiguredError("yunhealth");
	const fetcher = options.fetcher ?? fetch;

	return {
		async cancel(input, context) {
			const normalizedContext = normalizeAdapterCallContext(context);
			if (
				!normalizedContext ||
				!isBoundedOpaqueIdentifier(input.orderId) ||
				!Number.isSafeInteger(input.totalFen) ||
				input.totalFen <= 0
			)
				return invalidReference();
			const saved = reference(
				input.registrationContext,
				input.orderId,
				configuredHospitalId,
				workStationId,
			);
			const requestIds: string[] = [];
			const finish = (
				state: "cancelled" | "awaiting_confirmation" | "paid",
				providerStatus: string,
			) => {
				const trace: ExternalTrace = {
					provider: "yunhealth",
					operation: OPERATION,
					requestId: requestIds.at(-1) ?? normalizedContext.traceId,
					...(requestIds.length > 0
						? { requestIds: [...new Set(requestIds)] }
						: {}),
				};
				options.logger?.info(
					{
						event: "outpatient.self-payment.cancellation-result",
						orderId: input.orderId,
						traceId: normalizedContext.traceId,
						state,
						providerStatus,
						providerRequestCount: requestIds.length,
					},
					"Outpatient cancellation result observed",
				);
				return { state, providerStatus, trace };
			};
			const request = async (
				step: "query" | "cancel",
				body: Record<string, string | number | bigint>,
			) => {
				const key = createHash("sha256")
					.update(`${input.orderId}:${saved.businessId}:${saved.payingId}`)
					.digest("hex");
				const response = await requestJson<unknown>(
					{
						provider: "yunhealth",
						operation: step === "query" ? QUERY_OPERATION : CANCEL_OPERATION,
						url: baseUrl + (step === "query" ? QUERY_PATH : CANCEL_PATH),
						method: "POST",
						context: {
							...normalizedContext,
							idempotencyKey: `outpatient-cancel:${step}:${key}`,
						},
						...(authorization
							? {
									headers: {
										Authorization: authorization.startsWith("Bearer ")
											? authorization
											: `Bearer ${authorization}`,
									},
								}
							: {}),
						bodyText: stringifyJsonPreservingLargeIntegers(body),
						captureRawBody: true,
						...(options.logger ? { logger: options.logger } : {}),
					},
					fetcher,
				);
				requestIds.push(response.requestId);
				return successfulData(response.rawBodyText);
			};

			let queried: RecordValue | undefined;
			try {
				queried = await request("query", {
					authSysCode,
					autoSettle: 0,
					businessId: BigInt(saved.businessId),
					hospitalId: BigInt(saved.hospitalId),
					payingId: BigInt(saved.payingId),
					tradeTypeCode: "2",
					workStationId,
				});
			} catch {
				return finish("awaiting_confirmation", "payment_query_unavailable");
			}
			if (!queried)
				return finish("awaiting_confirmation", "payment_query_not_confirmed");
			if (
				!hasBoundInitiatingPayment(
					queried,
					saved,
					input.totalFen,
					input.registrationContext,
				)
			) {
				if (
					queried.success !== true ||
					positiveLong(queried.payTypeId) !== "5032" ||
					!referencesMatch(queried, saved)
				)
					return finish("awaiting_confirmation", "payment_query_not_confirmed");
				if (queried.code === 3 || queried.code === "3")
					return finish("paid", "payment_paid");
				if (queried.code !== 5 && queried.code !== "5")
					return finish(
						"awaiting_confirmation",
						"payment_not_confirmed_failed",
					);
			}

			if (hasConflictingPaymentEvidence(queried, input.totalFen))
				return finish(
					"awaiting_confirmation",
					"payment_query_conflicting_evidence",
				);
			let cancelled: RecordValue | undefined;
			try {
				cancelled = await request("cancel", {
					authSysCode,
					businessId: BigInt(saved.businessId),
					tradeTypeCode: "2",
					workStationId,
				});
			} catch {
				return finish("awaiting_confirmation", "settlement_cancel_unavailable");
			}
			if (
				!cancelled ||
				(cancelled.success !== undefined && cancelled.success !== true) ||
				!referencesMatch(cancelled, saved) ||
				(cancelled.cancelStatus !== "1" && cancelled.cancelStatus !== 1)
			)
				return finish(
					"awaiting_confirmation",
					"settlement_cancel_not_confirmed",
				);
			return finish("cancelled", "settlement_cancel_confirmed");
		},
	};
}
