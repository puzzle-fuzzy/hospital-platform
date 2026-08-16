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

/**
 * 2.6.33 文档明确冻结了 amount、billDeptName、billDocName、billDate 和费用标识等字段。
 * waitPayAmount、registerDept、registerDoctor 只来自旧端类型/调用线索，当前不是新的公共 contract；
 * 因此它们只能在 adapter 内部作为待 Provider fixture 确认的候选字段使用，不能进入 domain、API、日志或支付编排。
 */
type ProviderPaymentItem = {
	amount?: unknown;
	waitPayAmount?: unknown;
	/** 以下字段只用于服务端内部建立稳定费用引用，不进入公共读模型。 */
	mainId?: unknown;
	chargeId?: unknown;
	chargeCode?: unknown;
	itemName?: unknown;
	presCode?: unknown;
	billDeptName?: unknown;
	registerDept?: unknown;
	registerDoctor?: unknown;
	billDocName?: unknown;
	billDate?: unknown;
	outTradeOrderId?: unknown;
	registerId?: unknown;
	visitRecordId?: unknown;
};

function objectValue(value: unknown, requestId: string): ProviderPaymentItem {
	if (typeof value !== "object" || value === null || Array.isArray(value)) {
		throw providerError(
			"Zhongyang outpatient response item was invalid",
			requestId,
		);
	}
	return value as ProviderPaymentItem;
}

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
	// 显式的 0 元是合法金额；缺失金额不是 0，不能把未知金额伪装成零元，
	// 否则患者端会看到错误费用，未来还可能把错误读模型带入支付编排。
	if (value === undefined || value === null || value === "") {
		throw providerError("Zhongyang outpatient amount is missing", requestId);
	}
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

function identityText(value: unknown): string | undefined {
	if (value === undefined || value === null || value === "") return undefined;
	if (typeof value !== "string" && typeof value !== "number") return undefined;
	const normalized = String(value).trim();
	return normalized || undefined;
}

/**
 * 费用记录 ID 必须在不同查询排序和待缴/已缴状态之间保持稳定。
 *
 * 数组下标只能作为渲染辅助，不能进入业务引用：Provider 对同一账单的
 * 返回顺序可能变化，支付后 `tradeStatus` 也会改变。这里使用单据、就诊
 * 和项目标识组成内部哈希；缺少全部稳定标识时拒绝响应，避免把不可定位
 * 的费用伪装成可供后续详情/支付使用的 recordId。
 */
function opaqueRecordId(item: ProviderPaymentItem, requestId: string): string {
	const identityParts = [
		["outTradeOrderId", identityText(item.outTradeOrderId)],
		["registerId", identityText(item.registerId)],
		["visitRecordId", identityText(item.visitRecordId)],
		["mainId", identityText(item.mainId)],
		["chargeId", identityText(item.chargeId)],
		["chargeCode", identityText(item.chargeCode)],
		["presCode", identityText(item.presCode)],
		["itemName", identityText(item.itemName)],
	]
		.filter((entry): entry is [string, string] => entry[1] !== undefined)
		.map(([field, value]) => `${field}=${value}`);
	if (identityParts.length === 0) {
		throw providerError(
			"Zhongyang outpatient fee identity is missing",
			requestId,
		);
	}
	const canonicalIdentity = [
		identityParts,
		// 账单时间用于区分同一项目在不同开单时刻产生的记录；金额故意不参与，
		// 防止待缴金额与结算后金额变化造成同一业务记录换 ID。
		identityText(item.billDate) ?? "",
	];
	return createHash("sha256")
		.update(JSON.stringify(canonicalIdentity))
		.digest("hex")
		.slice(0, 32);
}

function responseItems(
	value: unknown,
	requestId: string,
): ProviderPaymentItem[] {
	if (Array.isArray(value)) {
		return value.map((item) => objectValue(item, requestId));
	}
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
		return envelope.data.map((item) => objectValue(item, requestId));
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
		recordId: opaqueRecordId(item, requestId),
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

/** 同一响应中的重复费用必须整批拒绝，不能让页面或未来支付选错项目。 */
function ensureUniqueRecordIds(
	records: readonly OutpatientPaymentRecord[],
	requestId: string,
): void {
	const seen = new Set<string>();
	for (const record of records) {
		if (seen.has(record.recordId)) {
			throw providerError(
				"Zhongyang outpatient response contained duplicate record ids",
				requestId,
			);
		}
		seen.add(record.recordId);
	}
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
		const records = items.map((item) =>
			mapRecord(item, input.status, response.requestId),
		);
		ensureUniqueRecordIds(records, response.requestId);
		return {
			records,
			trace: trace(response.requestId),
		};
	}
}

export function createZhongyangOutpatientPaymentGateway(
	options: ZhongyangGatewayOptions & { authSysCode?: string },
): OutpatientPaymentGateway {
	return new ZhongyangOutpatientPaymentApiGateway(options);
}
