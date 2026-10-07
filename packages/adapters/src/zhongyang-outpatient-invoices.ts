import type {
	AdapterCallContext,
	ExternalTrace,
	OutpatientElectronicInvoice,
	OutpatientElectronicInvoiceGateway,
	OutpatientElectronicInvoiceOperatorType,
	OutpatientElectronicInvoicePayerType,
} from "@hospital/domain";
import { AdapterNotConfiguredError, ProviderRequestError } from "./errors";
import { type ProviderFetcher, requestJson } from "./http";
import type { ZhongyangGatewayOptions } from "./zhongyang-patients";

const OUTPATIENT_ELECTRONIC_INVOICE_PATH =
	"/msun-middle-open-settlepay/v1/invoices/out-electrionic-invoices";
const OPERATION = "outpatient-electronic-invoice-issue";
const MAX_TEXT_LENGTH = 512;
const MAX_RESOURCE_LENGTH = 8_000_000;

type ProviderObject = Record<string, unknown>;

function configuredText(
	value: unknown,
	maxLength: number,
	allowEmpty = false,
): string {
	if (typeof value !== "string") {
		throw new AdapterNotConfiguredError("zhongyang");
	}
	const normalized = value.trim();
	if (
		(!allowEmpty && !normalized) ||
		normalized.length > maxLength ||
		Array.from(normalized).some((character) => character.charCodeAt(0) < 0x20)
	) {
		throw new AdapterNotConfiguredError("zhongyang");
	}
	return normalized;
}

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

function objectValue(value: unknown, requestId: string): ProviderObject {
	if (typeof value !== "object" || value === null || Array.isArray(value)) {
		throw providerError(
			"Zhongyang outpatient electronic invoice response was invalid",
			requestId,
		);
	}
	return value as ProviderObject;
}

function identifier(value: unknown, field: string, requestId: string): string {
	if (typeof value === "string") {
		if (
			!/^\d+$/.test(value) ||
			value === "0" ||
			value.length > MAX_TEXT_LENGTH
		) {
			throw providerError(
				`Zhongyang electronic invoice field ${field} is invalid`,
				requestId,
			);
		}
		return value;
	}
	if (typeof value === "number" && Number.isSafeInteger(value) && value > 0) {
		return String(value);
	}
	throw providerError(
		`Zhongyang electronic invoice field ${field} is invalid`,
		requestId,
	);
}

function optionalText(
	value: unknown,
	field: string,
	requestId: string,
	maxLength = MAX_TEXT_LENGTH,
): string | undefined {
	if (value === undefined || value === null) return undefined;
	if (typeof value !== "string" && typeof value !== "number") {
		throw providerError(
			`Zhongyang electronic invoice field ${field} is invalid`,
			requestId,
		);
	}
	const normalized = String(value).trim();
	if (
		!normalized ||
		normalized.length > maxLength ||
		Array.from(normalized).some((character) => character.charCodeAt(0) < 0x20)
	) {
		throw providerError(
			`Zhongyang electronic invoice field ${field} is invalid`,
			requestId,
		);
	}
	return normalized;
}

/**
 * 众阳将没有可用公网票据地址的可选资源字段返回为空字符串。空值不应让已经
 * 成功开具的发票被误判为整份响应非法；但其他文本字段（例如票据号）仍保持
 * 严格校验，避免把缺失的业务标识静默吞掉。
 */
function optionalResourceText(
	value: unknown,
	field: string,
	requestId: string,
	maxLength = MAX_RESOURCE_LENGTH,
): string | undefined {
	if (value === undefined || value === null) return undefined;
	if (typeof value !== "string" && typeof value !== "number") {
		throw providerError(
			`Zhongyang electronic invoice field ${field} is invalid`,
			requestId,
		);
	}
	const normalized = String(value).trim();
	if (!normalized) return undefined;
	if (
		normalized.length > maxLength ||
		Array.from(normalized).some((character) => character.charCodeAt(0) < 0x20)
	) {
		throw providerError(
			`Zhongyang electronic invoice field ${field} is invalid`,
			requestId,
		);
	}
	return normalized;
}

function normalizeInput(value: unknown): {
	invoiceMainId: string;
	outSettleMainId: string;
	payerType: OutpatientElectronicInvoicePayerType;
} {
	if (typeof value !== "object" || value === null || Array.isArray(value)) {
		throw providerError("Zhongyang electronic invoice request is invalid");
	}
	const record = value as Record<string, unknown>;
	const allowed = new Set(["invoiceMainId", "outSettleMainId", "payerType"]);
	if (Object.keys(record).some((key) => !allowed.has(key))) {
		throw providerError("Zhongyang electronic invoice request is invalid");
	}
	const invoiceMainId = record.invoiceMainId;
	const outSettleMainId = record.outSettleMainId;
	if (
		typeof invoiceMainId !== "string" ||
		!/^\d+$/.test(invoiceMainId) ||
		invoiceMainId === "0" ||
		invoiceMainId.length > MAX_TEXT_LENGTH ||
		typeof outSettleMainId !== "string" ||
		!/^\d+$/.test(outSettleMainId) ||
		outSettleMainId === "0" ||
		outSettleMainId.length > MAX_TEXT_LENGTH
	) {
		throw providerError(
			"Zhongyang electronic invoice request identifiers are invalid",
		);
	}
	if (record.payerType !== "1" && record.payerType !== "2") {
		throw providerError("Zhongyang electronic invoice payerType is invalid");
	}
	return {
		invoiceMainId,
		outSettleMainId,
		payerType: record.payerType,
	};
}

function requestBody(input: {
	invoiceMainId: string;
	outSettleMainId: string;
	payerType: OutpatientElectronicInvoicePayerType;
	authSysCode: string;
	workStationId: string;
	hospitalId: string;
	operatorType: OutpatientElectronicInvoiceOperatorType;
}): string {
	// Provider 文档把三个 ID 声明为整型，但院内 ID 可能超过 JS 安全整数。
	// 使用 bodyText 保留 JSON 数字的原始十进制字面量，避免先转 Number 丢精度。
	return [
		`"invoiceMainId":${input.invoiceMainId}`,
		`"outSettleMainId":${input.outSettleMainId}`,
		`"payerType":${JSON.stringify(input.payerType)}`,
		`"authSysCode":${JSON.stringify(input.authSysCode)}`,
		`"workStationId":${JSON.stringify(input.workStationId)}`,
		`"hospitalId":${input.hospitalId}`,
		`"operatorType":${input.operatorType}`,
	]
		.join(",")
		.replace(/^/, "{")
		.concat("}");
}

function mapInvoice(
	data: unknown,
	requestId: string,
): OutpatientElectronicInvoice {
	const item = objectValue(data, requestId);
	const invoice: OutpatientElectronicInvoice = {};
	const billBatchCode = optionalText(
		item.billBatchCode,
		"billBatchCode",
		requestId,
	);
	if (billBatchCode !== undefined) invoice.billBatchCode = billBatchCode;
	const billNo = optionalText(item.billNo, "billNo", requestId);
	if (billNo !== undefined) invoice.billNo = billNo;
	const billQrCode = optionalText(
		item.billQrCode,
		"billQrCode",
		requestId,
		MAX_RESOURCE_LENGTH,
	);
	if (billQrCode !== undefined) invoice.billQrCode = billQrCode;
	const createTime = optionalText(item.createTime, "createTime", requestId);
	if (createTime !== undefined) invoice.createTime = createTime;
	if (item.hospitalId !== undefined && item.hospitalId !== null) {
		invoice.hospitalId = identifier(item.hospitalId, "hospitalId", requestId);
	}
	const invalidFlag = optionalText(item.invalidFlag, "invalidFlag", requestId);
	if (invalidFlag !== undefined) invoice.invalidFlag = invalidFlag;
	if (
		item.outElectronicInvoiceId !== undefined &&
		item.outElectronicInvoiceId !== null
	) {
		invoice.outElectronicInvoiceId = identifier(
			item.outElectronicInvoiceId,
			"outElectronicInvoiceId",
			requestId,
		);
	}
	if (item.outInvoiceMainId !== undefined && item.outInvoiceMainId !== null) {
		invoice.outInvoiceMainId = identifier(
			item.outInvoiceMainId,
			"outInvoiceMainId",
			requestId,
		);
	}
	if (item.outSettleMainId !== undefined && item.outSettleMainId !== null) {
		invoice.outSettleMainId = identifier(
			item.outSettleMainId,
			"outSettleMainId",
			requestId,
		);
	}
	const pictureNetUrl = optionalResourceText(
		item.pictureNetUrl,
		"pictureNetUrl",
		requestId,
	);
	if (pictureNetUrl !== undefined) invoice.pictureNetUrl = pictureNetUrl;
	const pictureUrl = optionalResourceText(
		item.pictureUrl,
		"pictureUrl",
		requestId,
	);
	if (pictureUrl !== undefined) invoice.pictureUrl = pictureUrl;
	const random = optionalText(item.random, "random", requestId);
	if (random !== undefined) invoice.random = random;
	return invoice;
}

function trace(requestId: string): ExternalTrace {
	return { provider: "zhongyang", operation: OPERATION, requestId };
}

export class ZhongyangOutpatientElectronicInvoiceApiGateway
	implements OutpatientElectronicInvoiceGateway
{
	private readonly baseUrl: string;
	private readonly authorizationToken: string | undefined;
	private readonly authSysCode: string;
	private readonly workStationId: string;
	private readonly hospitalId: string;
	private readonly operatorType: OutpatientElectronicInvoiceOperatorType;
	private readonly fetcher: ProviderFetcher;

	constructor(
		options: ZhongyangGatewayOptions & {
			authSysCode: string;
			workStationId: string;
			hospitalId: string;
			operatorType: OutpatientElectronicInvoiceOperatorType;
		},
	) {
		this.baseUrl = configuredText(options.baseUrl, 2048).replace(/\/$/, "");
		this.authorizationToken = options.authorizationToken?.trim() || undefined;
		this.authSysCode = configuredText(options.authSysCode, 100);
		// Provider 文档说明无设备对账时可不区分设备；院方已确认本链路
		// 传空字符串，因此不能用“必填非空”规则误拦截。
		this.workStationId = configuredText(options.workStationId, 100, true);
		this.hospitalId = configuredText(options.hospitalId, MAX_TEXT_LENGTH);
		if (!/^\d+$/.test(this.hospitalId) || this.hospitalId === "0") {
			throw new AdapterNotConfiguredError("zhongyang");
		}
		if (![0, 1, 2].includes(options.operatorType)) {
			throw new AdapterNotConfiguredError("zhongyang");
		}
		this.operatorType = options.operatorType;
		this.fetcher = options.fetcher ?? fetch;
	}

	async issue(
		input: {
			invoiceMainId: string;
			outSettleMainId: string;
			payerType: OutpatientElectronicInvoicePayerType;
		},
		context: AdapterCallContext,
	) {
		const normalizedInput = normalizeInput(input);
		const url = new URL(OUTPATIENT_ELECTRONIC_INVOICE_PATH, this.baseUrl);
		const response = await requestJson<unknown>(
			{
				provider: "zhongyang",
				operation: OPERATION,
				url: url.toString(),
				method: "POST",
				context,
				bodyText: requestBody({
					...normalizedInput,
					authSysCode: this.authSysCode,
					workStationId: this.workStationId,
					hospitalId: this.hospitalId,
					operatorType: this.operatorType,
				}),
				...(this.authorizationToken
					? { headers: { Authorization: `Bearer ${this.authorizationToken}` } }
					: {}),
			},
			this.fetcher,
		);
		const envelope = objectValue(response.data, response.requestId);
		if (envelope.success !== true) {
			throw providerError(
				"Zhongyang outpatient electronic invoice provider rejected the request",
				response.requestId,
				false,
			);
		}
		const invoice = mapInvoice(envelope.data, response.requestId);
		return { invoice, trace: trace(response.requestId) };
	}
}

export function createZhongyangOutpatientElectronicInvoiceGateway(
	options: ZhongyangGatewayOptions & {
		authSysCode: string;
		workStationId: string;
		hospitalId: string;
		operatorType: OutpatientElectronicInvoiceOperatorType;
	},
): OutpatientElectronicInvoiceGateway {
	return new ZhongyangOutpatientElectronicInvoiceApiGateway(options);
}
