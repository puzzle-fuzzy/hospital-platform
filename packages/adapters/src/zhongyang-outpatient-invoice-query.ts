import type {
	AdapterCallContext,
	ExternalTrace,
	OutpatientElectronicInvoiceQueryGateway,
	OutpatientElectronicInvoiceRecord,
} from "@hospital/domain";
import { parseOutpatientBillDateTime } from "@hospital/domain";
import { AdapterNotConfiguredError, ProviderRequestError } from "./errors";
import { type ProviderFetcher, requestJson } from "./http";
import type { ZhongyangGatewayOptions } from "./zhongyang-patients";

const OUTPATIENT_INVOICE_QUERY_PATH =
	"/msun-middle-open-settlepay/v1/out-invoice-mains/main-lists";
const OPERATION = "outpatient-electronic-invoice-records";
const MAX_RECORDS = 500;
const MAX_TEXT_LENGTH = 512;
const MAX_RESOURCE_LENGTH = 8_000_000;

type ProviderObject = Record<string, unknown>;

function providerError(
	message: string,
	requestId?: string,
	responseInvalid = true,
): ProviderRequestError {
	return new ProviderRequestError({
		provider: "zhongyang",
		operation: OPERATION,
		message,
		retryable: false,
		responseInvalid,
		...(requestId ? { requestId } : {}),
	});
}

function requiredConfig(value: unknown): string {
	if (typeof value !== "string") {
		throw new AdapterNotConfiguredError("zhongyang");
	}
	const normalized = value.trim();
	if (!normalized) throw new AdapterNotConfiguredError("zhongyang");
	return normalized;
}

function objectValue(value: unknown, requestId: string): ProviderObject {
	if (typeof value !== "object" || value === null || Array.isArray(value)) {
		throw providerError(
			"Zhongyang outpatient invoice response was invalid",
			requestId,
		);
	}
	return value as ProviderObject;
}

function identifier(value: unknown, field: string, requestId: string): string {
	if (typeof value === "string") {
		if (
			!/^[0-9]+$/u.test(value) ||
			value === "0" ||
			value.length > MAX_TEXT_LENGTH
		) {
			throw providerError(
				`Zhongyang invoice field ${field} is invalid`,
				requestId,
			);
		}
		return value;
	}
	if (typeof value === "number" && Number.isSafeInteger(value) && value > 0) {
		return String(value);
	}
	throw providerError(`Zhongyang invoice field ${field} is invalid`, requestId);
}

function optionalText(
	value: unknown,
	field: string,
	requestId: string,
	maxLength = MAX_TEXT_LENGTH,
): string | undefined {
	if (value === undefined || value === null || value === "") return undefined;
	if (typeof value !== "string" && typeof value !== "number") {
		throw providerError(
			`Zhongyang invoice field ${field} is invalid`,
			requestId,
		);
	}
	const normalized = String(value).trim();
	if (
		!normalized ||
		normalized.length > maxLength ||
		Array.from(normalized).some((character) => {
			const code = character.charCodeAt(0);
			return code <= 0x1f || code === 0x7f;
		})
	) {
		throw providerError(
			`Zhongyang invoice field ${field} is invalid`,
			requestId,
		);
	}
	return normalized;
}

function amountFen(value: unknown, requestId: string): number {
	if (typeof value !== "string" && typeof value !== "number") {
		throw providerError("Zhongyang invoice amount is invalid", requestId);
	}
	const normalized = String(value).trim();
	if (!/^\d+(?:\.\d{1,2})?$/u.test(normalized)) {
		throw providerError("Zhongyang invoice amount is invalid", requestId);
	}
	const [yuanText = "0", fractionText = ""] = normalized.split(".");
	const yuan = BigInt(yuanText.replace(/^0+(?=\d)/u, ""));
	const fraction = BigInt(`${fractionText}00`.slice(0, 2));
	const fen = yuan * 100n + fraction;
	if (fen > BigInt(Number.MAX_SAFE_INTEGER)) {
		throw providerError("Zhongyang invoice amount is out of range", requestId);
	}
	return Number(fen);
}

function normalizeInput(value: unknown) {
	if (typeof value !== "object" || value === null || Array.isArray(value)) {
		throw providerError(
			"Zhongyang outpatient invoice query is invalid",
			undefined,
			false,
		);
	}
	const input = value as Record<string, unknown>;
	if (
		typeof input.providerPatientId !== "string" ||
		!input.providerPatientId.trim()
	) {
		throw providerError(
			"Zhongyang outpatient invoice patient is invalid",
			undefined,
			false,
		);
	}
	const startTime =
		typeof input.startTime === "string"
			? parseOutpatientBillDateTime(input.startTime)
			: undefined;
	const endTime =
		typeof input.endTime === "string"
			? parseOutpatientBillDateTime(input.endTime)
			: undefined;
	if (
		typeof input.startTime !== "string" ||
		typeof input.endTime !== "string" ||
		startTime === undefined ||
		endTime === undefined ||
		startTime > endTime
	) {
		throw providerError(
			"Zhongyang outpatient invoice time range is invalid",
			undefined,
			false,
		);
	}
	if (
		input.settleStatus !== undefined &&
		input.settleStatus !== "4" &&
		input.settleStatus !== "5"
	) {
		throw providerError(
			"Zhongyang outpatient invoice status is invalid",
			undefined,
			false,
		);
	}
	const pageNum = input.pageNum ?? 1;
	const pageSize = input.pageSize ?? MAX_RECORDS;
	if (
		typeof pageNum !== "number" ||
		!Number.isSafeInteger(pageNum) ||
		pageNum < 1 ||
		typeof pageSize !== "number" ||
		!Number.isSafeInteger(pageSize) ||
		pageSize < 1 ||
		pageSize > MAX_RECORDS
	) {
		throw providerError(
			"Zhongyang outpatient invoice paging is invalid",
			undefined,
			false,
		);
	}
	return {
		providerPatientId: input.providerPatientId.trim(),
		startTime: input.startTime,
		endTime: input.endTime,
		...(input.settleStatus ? { settleStatus: input.settleStatus } : {}),
		pageNum,
		pageSize,
	};
}

function mapRecord(
	value: unknown,
	requestId: string,
): OutpatientElectronicInvoiceRecord {
	const item = objectValue(value, requestId);
	const record: OutpatientElectronicInvoiceRecord = {
		outInvoiceMainId: identifier(
			item.outInvoiceMainId,
			"outInvoiceMainId",
			requestId,
		),
		outSettleMainId: identifier(
			item.outSettleMainId,
			"outSettleMainId",
			requestId,
		),
	};
	const invoiceCode = optionalText(item.invoiceCode, "invoiceCode", requestId);
	if (invoiceCode !== undefined) record.invoiceCode = invoiceCode;
	const invoiceTime = optionalText(item.invoiceTime, "invoiceTime", requestId);
	if (invoiceTime !== undefined) record.invoiceTime = invoiceTime;
	if (item.amount !== undefined && item.amount !== null) {
		record.amountFen = amountFen(item.amount, requestId);
	}
	for (const [field, maxLength] of [
		["billBatchCode", MAX_TEXT_LENGTH],
		["billNo", MAX_TEXT_LENGTH],
		["random", MAX_TEXT_LENGTH],
		["pictureNetUrl", MAX_RESOURCE_LENGTH],
		["pictureUrl", MAX_RESOURCE_LENGTH],
	] as const) {
		const text = optionalText(item[field], field, requestId, maxLength);
		if (text !== undefined) record[field] = text;
	}
	return record;
}

export class ZhongyangOutpatientElectronicInvoiceQueryApiGateway
	implements OutpatientElectronicInvoiceQueryGateway
{
	private readonly baseUrl: string;
	private readonly authorizationToken: string | undefined;
	private readonly fetcher: ProviderFetcher;

	constructor(options: ZhongyangGatewayOptions) {
		this.baseUrl = requiredConfig(options.baseUrl).replace(/\/$/u, "");
		this.authorizationToken = options.authorizationToken?.trim() || undefined;
		this.fetcher = options.fetcher ?? fetch;
	}

	async listRecords(input: unknown, context: AdapterCallContext) {
		const normalized = normalizeInput(input);
		const url = new URL(OUTPATIENT_INVOICE_QUERY_PATH, this.baseUrl);
		url.searchParams.set("patId", normalized.providerPatientId);
		url.searchParams.set("startTime", normalized.startTime);
		url.searchParams.set("endTime", normalized.endTime);
		if (normalized.settleStatus)
			url.searchParams.set("settleStatus", normalized.settleStatus);
		url.searchParams.set("pageNum", String(normalized.pageNum));
		url.searchParams.set("pageSize", String(normalized.pageSize));
		const response = await requestJson<unknown>(
			{
				provider: "zhongyang",
				operation: OPERATION,
				url: url.toString(),
				method: "GET",
				context,
				...(this.authorizationToken
					? { headers: { Authorization: `Bearer ${this.authorizationToken}` } }
					: {}),
			},
			this.fetcher,
		);
		const envelope = objectValue(response.data, response.requestId);
		if (envelope.success !== true) {
			throw providerError(
				"Zhongyang outpatient invoice provider rejected the request",
				response.requestId,
				false,
			);
		}
		if (!Array.isArray(envelope.data) || envelope.data.length > MAX_RECORDS) {
			throw providerError(
				"Zhongyang outpatient invoice response records are invalid",
				response.requestId,
			);
		}
		const records = envelope.data.map((item) =>
			mapRecord(item, response.requestId),
		);
		const keys = new Set<string>();
		for (const record of records) {
			const key = `${record.outInvoiceMainId}:${record.outSettleMainId}`;
			if (keys.has(key)) {
				throw providerError(
					"Zhongyang outpatient invoice response contains duplicate records",
					response.requestId,
				);
			}
			keys.add(key);
		}
		return {
			records,
			trace: {
				provider: "zhongyang" as const,
				operation: OPERATION,
				requestId: response.requestId,
			} satisfies ExternalTrace,
		};
	}
}

export function createZhongyangOutpatientElectronicInvoiceQueryGateway(
	options: ZhongyangGatewayOptions,
): OutpatientElectronicInvoiceQueryGateway {
	return new ZhongyangOutpatientElectronicInvoiceQueryApiGateway(options);
}
