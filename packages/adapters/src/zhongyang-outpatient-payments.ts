import { createHash } from "node:crypto";
import type {
	AdapterCallContext,
	ExternalTrace,
	OutpatientPaymentGateway,
	OutpatientPaymentRecord,
	OutpatientPaymentStatus,
} from "@hospital/domain";
import { AdapterNotConfiguredError, ProviderRequestError } from "./errors";
import { type ProviderFetcher, requestJson } from "./http";
import type { ZhongyangGatewayOptions } from "./zhongyang-patients";

const OUTPATIENT_PAYMENT_PATH =
	"/msun-middle-open-settlepay/v1/outpatient-payments/outpatient-child-payment-records";
const OPERATION = "outpatient-payment-records";

type ProviderPaymentItem = {
	amount?: unknown;
	waitPayAmount?: unknown;
	billDeptName?: unknown;
	registerDept?: unknown;
	registerDoctor?: unknown;
	billDocName?: unknown;
	billDate?: unknown;
	outTradeOrderId?: unknown;
	registerId?: unknown;
	visitRecordId?: unknown;
};

function requiredConfig(value: string): string {
	const normalized = value.trim();
	if (!normalized) throw new AdapterNotConfiguredError("zhongyang");
	return normalized;
}

function providerError(
	message: string,
	requestId?: string,
): ProviderRequestError {
	return new ProviderRequestError({
		provider: "zhongyang",
		operation: OPERATION,
		message,
		retryable: false,
		...(requestId ? { requestId } : {}),
	});
}

function textField(
	value: unknown,
	field: string,
	requestId: string,
): string | undefined {
	if (value === undefined || value === null) return undefined;
	if (typeof value !== "string" && typeof value !== "number") {
		throw providerError(
			`Zhongyang outpatient field ${field} is invalid`,
			requestId,
		);
	}
	const normalized = String(value).trim();
	if (!normalized || normalized.length > 256) {
		throw providerError(
			`Zhongyang outpatient field ${field} is invalid`,
			requestId,
		);
	}
	return normalized;
}

/** provider 金额单位为元；在 adapter 边界无损转换成服务端统一的分。 */
function amountFen(value: unknown, requestId: string): number {
	if (value === undefined || value === null || value === "") return 0;
	const normalized = String(value).trim();
	if (!/^\d+(?:\.\d{1,2})?$/.test(normalized)) {
		throw providerError("Zhongyang outpatient amount is invalid", requestId);
	}
	const [yuan, fraction = ""] = normalized.split(".");
	const fen = Number(yuan) * 100 + Number(`${fraction}00`.slice(0, 2));
	if (!Number.isSafeInteger(fen)) {
		throw providerError(
			"Zhongyang outpatient amount is out of range",
			requestId,
		);
	}
	return fen;
}

function opaqueRecordId(item: ProviderPaymentItem, index: number): string {
	const identity = [
		item.outTradeOrderId,
		item.registerId,
		item.visitRecordId,
		item.billDate,
		index,
	]
		.map((value) => String(value ?? ""))
		.join("|");
	return createHash("sha256").update(identity).digest("hex").slice(0, 32);
}

function responseItems(
	value: unknown,
	requestId: string,
): ProviderPaymentItem[] {
	if (Array.isArray(value)) return value as ProviderPaymentItem[];
	if (typeof value !== "object" || value === null) {
		throw providerError(
			"Zhongyang outpatient response data was invalid",
			requestId,
		);
	}
	const envelope = value as { success?: unknown; data?: unknown };
	if (envelope.success === false) {
		throw providerError(
			"Zhongyang outpatient provider rejected the request",
			requestId,
		);
	}
	if (Array.isArray(envelope.data)) {
		return envelope.data as ProviderPaymentItem[];
	}
	throw providerError(
		"Zhongyang outpatient response data was invalid",
		requestId,
	);
}

function mapRecord(
	item: ProviderPaymentItem,
	status: OutpatientPaymentStatus,
	requestId: string,
	index: number,
): OutpatientPaymentRecord {
	const billDate = textField(item.billDate, "billDate", requestId);
	if (!billDate) {
		throw providerError("Zhongyang outpatient billDate is missing", requestId);
	}
	const departmentName = textField(
		item.billDeptName ?? item.registerDept,
		"departmentName",
		requestId,
	);
	const doctorName = textField(
		item.registerDoctor ?? item.billDocName,
		"doctorName",
		requestId,
	);
	return {
		recordId: opaqueRecordId(item, index),
		status,
		...(departmentName ? { departmentName } : {}),
		...(doctorName ? { doctorName } : {}),
		billDate,
		amountFen: amountFen(
			status === "unpaid"
				? (item.waitPayAmount ?? item.amount)
				: (item.amount ?? item.waitPayAmount),
			requestId,
		),
	};
}

function trace(requestId: string): ExternalTrace {
	return { provider: "zhongyang", operation: OPERATION, requestId };
}

/** 众阳 2.6.33 门诊费用只读 adapter；不承载支付、医保或结算写入。 */
export class ZhongyangOutpatientPaymentApiGateway
	implements OutpatientPaymentGateway
{
	private readonly baseUrl: string;
	private readonly authorizationToken: string | undefined;
	private readonly authSysCode: string;
	private readonly fetcher: ProviderFetcher;

	constructor(
		options: ZhongyangGatewayOptions & {
			authSysCode?: string;
		},
	) {
		this.baseUrl = requiredConfig(options.baseUrl);
		this.authorizationToken = options.authorizationToken?.trim() || undefined;
		this.authSysCode = options.authSysCode?.trim() || "thirdSelfMachine";
		this.fetcher = options.fetcher ?? fetch;
	}

	async listRecords(
		input: {
			providerPatientId: string;
			startTime: string;
			endTime: string;
			status: OutpatientPaymentStatus;
			authSysCode: string;
		},
		context: AdapterCallContext,
	) {
		const url = new URL(OUTPATIENT_PAYMENT_PATH, this.baseUrl);
		url.searchParams.set("patId", input.providerPatientId);
		url.searchParams.set("startTime", input.startTime);
		url.searchParams.set("endTime", input.endTime);
		url.searchParams.set("tradeStatus", input.status === "unpaid" ? "1" : "3");
		url.searchParams.set("authSysCode", input.authSysCode || this.authSysCode);
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
		const items = responseItems(response.data, response.requestId);
		return {
			records: items.map((item, index) =>
				mapRecord(item, input.status, response.requestId, index),
			),
			trace: trace(response.requestId),
		};
	}
}

export function createZhongyangOutpatientPaymentGateway(
	options: ZhongyangGatewayOptions & { authSysCode?: string },
): OutpatientPaymentGateway {
	return new ZhongyangOutpatientPaymentApiGateway(options);
}
