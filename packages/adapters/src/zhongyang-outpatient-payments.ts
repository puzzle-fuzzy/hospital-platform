import { createHash } from "node:crypto";
import type {
	AdapterCallContext,
	ExternalTrace,
	OutpatientPaymentGateway,
	OutpatientPaymentRecord,
	OutpatientPaymentStatus,
} from "@hospital/domain";
import {
	InvalidOutpatientPaymentStatusError,
	isOutpatientPaymentStatus,
	MAX_OUTPATIENT_PAYMENT_RECORDS,
} from "@hospital/domain";
import { AdapterNotConfiguredError, ProviderRequestError } from "./errors";
import { type ProviderFetcher, requestJson } from "./http";
import type { ZhongyangGatewayOptions } from "./zhongyang-patients";

/** 众阳 2.6.33 门诊子项目费用只读接口；支付调起和医保结算不复用此路径。 */
const OUTPATIENT_PAYMENT_PATH =
	"/msun-middle-open-settlepay/v1/outpatient-payments/outpatient-child-payment-records";
/** 低敏日志中的稳定操作名，用于与 Provider 原始路径解耦并关联请求链。 */
const OPERATION = "outpatient-payment-records";
/** 费用内部身份字段的单字段长度上限，避免异常 Provider 值放大哈希计算。 */
const MAX_PAYMENT_IDENTITY_FIELD_LENGTH = 256;

/**
 * 2.6.33 文档明确冻结了 amount、billDeptName、billDocName、billDate 和费用标识等字段。
 * waitPayAmount、registerDept、registerDoctor 只来自旧端类型/调用线索，当前不是新的 contract，
 * 因此故意不读取它们：未确认字段不能参与金额计算、公共展示、日志或未来支付编排。
 */
type ProviderPaymentItem = {
	amount?: unknown;
	/**
	 * 2.6.33 响应中的订单状态：1=待支付、2=已生成结算、3=已支付、
	 * 4=退款中、5=已退款、9=作废。公共只读模型只能确认 1/3；其余状态
	 * 没有独立 contract，不能粗暴映射成 paid，只在 adapter 内 fail-closed。
	 */
	tradeStatus?: unknown;
	/** 以下字段只用于服务端内部建立稳定费用引用，不进入公共读模型。 */
	mainId?: unknown;
	chargeId?: unknown;
	chargeCode?: unknown;
	presCode?: unknown;
	billDeptName?: unknown;
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
	/** 默认是响应读模型异常；明确的 Provider 业务拒绝由调用方传 false。 */
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

function textField(
	value: unknown,
	field: string,
	requestId: string,
	maxLength: number,
): string | undefined {
	if (value === undefined || value === null) return undefined;
	if (typeof value !== "string" && typeof value !== "number") {
		throw providerError(
			`Zhongyang outpatient field ${field} is invalid`,
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
		// 费用科室、医生和账单时间会直接进入患者端读模型；控制字符
		// 不能被当作普通 Provider 文本展示或持久化。
		throw providerError(
			`Zhongyang outpatient field ${field} is invalid`,
			requestId,
		);
	}
	return normalized;
}

/**
 * 校验 2.6.33 的账单时间，并保留 provider 约定的中国标准时间文本。
 *
 * 这个字段不是普通备注：页面会按它展示账单发生时间，recordId 也会把它
 * 纳入稳定身份计算。只做长度校验会让 `2026-02-31`、带时区的 ISO 文本或
 * 其他自然语言进入公共读模型，导致跨端解释不一致；在 adapter 边界拒绝
 * 非法日期，才能保证服务层拿到的是可展示、可关联的业务事实。
 */
function billDateText(value: unknown, requestId: string): string {
	const normalized = textField(value, "billDate", requestId, 64);
	if (!normalized) {
		throw providerError("Zhongyang outpatient billDate is missing", requestId);
	}

	const match = /^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2}):(\d{2})$/.exec(
		normalized,
	);
	if (!match) {
		throw providerError("Zhongyang outpatient billDate is invalid", requestId);
	}

	const [, yearText, monthText, dayText, hourText, minuteText, secondText] =
		match;
	const year = Number(yearText);
	const month = Number(monthText);
	const day = Number(dayText);
	const hour = Number(hourText);
	const minute = Number(minuteText);
	const second = Number(secondText);
	const leapYear = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
	const daysInMonth = [
		31,
		leapYear ? 29 : 28,
		31,
		30,
		31,
		30,
		31,
		31,
		30,
		31,
		30,
		31,
	][month - 1];
	if (
		year < 1 ||
		month < 1 ||
		month > 12 ||
		day < 1 ||
		day > (daysInMonth ?? 0) ||
		hour > 23 ||
		minute > 59 ||
		second > 59
	) {
		throw providerError("Zhongyang outpatient billDate is invalid", requestId);
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
	const [yuanText = "0", fractionText = ""] = normalized.split(".");
	// 元整数部分允许前导零，但先去掉前导零再限制长度，避免对异常超长
	// 字符串直接执行 BigInt，防止上游脏数据放大解析成本。
	const yuanWithoutLeadingZeros = yuanText.replace(/^0+(?=\d)/, "");
	if (yuanWithoutLeadingZeros.length > 14) {
		throw providerError(
			"Zhongyang outpatient amount is out of range",
			requestId,
		);
	}

	// 金额转换不能使用浮点乘法：即使最终字段是整数，浮点舍入也可能
	// 在安全整数边界附近改变分值。BigInt 先按十进制精确拼出分，再转换
	// 为 JSON/领域层使用的 number，并明确拒绝超过 Number 安全整数的金额。
	const yuan = BigInt(yuanWithoutLeadingZeros);
	const fraction = BigInt(`${fractionText}00`.slice(0, 2));
	const fen = yuan * 100n + fraction;
	const maxSafeFen = BigInt(Number.MAX_SAFE_INTEGER);
	if (fen > maxSafeFen) {
		throw providerError(
			"Zhongyang outpatient amount is out of range",
			requestId,
		);
	}
	return Number(fen);
}

/**
 * 校验 Provider 返回的订单状态与本次查询条件一致。
 *
 * 不能只相信请求参数并给整批记录贴上 `unpaid`/`paid` 标签：Provider
 * 可能因为数据错配、查询条件失效或上游返回异常而返回另一种状态。
 * 2.6.33 已明确响应中的 `tradeStatus`，因此缺失或不一致都必须整批
 * 失败，避免把已支付记录展示成待支付，或把错误读模型带入未来支付编排。
 */
function verifyTradeStatus(
	value: unknown,
	status: OutpatientPaymentStatus,
	requestId: string,
): void {
	const expected = status === "unpaid" ? "1" : "3";
	if (typeof value !== "string" && typeof value !== "number") {
		throw providerError(
			"Zhongyang outpatient tradeStatus is missing or invalid",
			requestId,
		);
	}
	const actual = String(value).trim();
	if (actual !== expected) {
		throw providerError(
			"Zhongyang outpatient tradeStatus did not match the requested status",
			requestId,
		);
	}
}

/**
 * 解析参与费用 opaque recordId 的 Provider 身份字段。
 *
 * 这些字段不进入公共响应，但它们决定同一费用在返回顺序变化、状态切换
 * 或未来支付详情引用中的稳定性。字段“存在但格式异常”不能静默当作缺失，
 * 否则另一组字段可能生成一个看似合法但指向错误账单的 recordId；同时必须
 * 限制长度和控制字符，避免未经审计的上游值进入哈希输入和关联链。
 */
function identityText(
	value: unknown,
	field: string,
	requestId: string,
): string | undefined {
	if (value === undefined || value === null || value === "") return undefined;
	if (
		typeof value !== "string" &&
		(typeof value !== "number" || !Number.isFinite(value))
	) {
		throw providerError(
			`Zhongyang outpatient identity field ${field} is invalid`,
			requestId,
		);
	}
	const raw = String(value);
	const normalized = raw.trim();
	if (
		raw.length > MAX_PAYMENT_IDENTITY_FIELD_LENGTH ||
		Array.from(raw).some((character) => {
			const code = character.charCodeAt(0);
			return code <= 0x1f || code === 0x7f;
		})
	) {
		throw providerError(
			`Zhongyang outpatient identity field ${field} is invalid`,
			requestId,
		);
	}
	return normalized || undefined;
}

/**
 * 费用记录 ID 必须在不同查询排序和待缴/已缴状态之间保持稳定。
 *
 * 数组下标只能作为渲染辅助，不能进入业务引用：Provider 对同一账单的
 * 返回顺序可能变化，支付后 `tradeStatus` 也会改变。这里使用单据、就诊
 * 和项目标识组成内部哈希；`itemName` 只是展示文本，不属于稳定身份，不能
 * 作为最后 fallback。缺少单据、就诊或费用 ID 时拒绝响应，避免把不可定位
 * 的费用伪装成可供后续详情/支付使用的 recordId。
 */
function opaqueRecordId(item: ProviderPaymentItem, requestId: string): string {
	const identityParts = [
		[
			"outTradeOrderId",
			identityText(item.outTradeOrderId, "outTradeOrderId", requestId),
		],
		["registerId", identityText(item.registerId, "registerId", requestId)],
		[
			"visitRecordId",
			identityText(item.visitRecordId, "visitRecordId", requestId),
		],
		["mainId", identityText(item.mainId, "mainId", requestId)],
		["chargeId", identityText(item.chargeId, "chargeId", requestId)],
		["chargeCode", identityText(item.chargeCode, "chargeCode", requestId)],
		["presCode", identityText(item.presCode, "presCode", requestId)],
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
		identityText(item.billDate, "billDate", requestId) ?? "",
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
		if (value.length > MAX_OUTPATIENT_PAYMENT_RECORDS) {
			// 必须在 object 映射、金额计算和费用 ID 哈希之前拒绝异常大响应；
			// 不能先全部展开再截断，否则资源放大已经发生。
			throw providerError(
				"Zhongyang outpatient response contained too many records",
				requestId,
			);
		}
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
			false,
		);
	}
	// 2.6.33 的响应包络明确包含布尔型 success；不能因为 data 恰好是数组
	// 就跳过这个事实校验。否则上游返回 `{ data: [] }`、`success: "false"`
	// 或其他异常包络时，患者端会看到“暂无费用”，把 Provider 故障误报成
	// 合法空列表。裸数组仍作为兼容 2.6.33 实际返回体的独立形态处理，
	// 但一旦选择包络形态，就必须明确声明 success=true。
	if (envelope.success !== true) {
		throw providerError(
			"Zhongyang outpatient response success flag was invalid",
			requestId,
		);
	}
	if (Array.isArray(envelope.data)) {
		if (envelope.data.length > MAX_OUTPATIENT_PAYMENT_RECORDS) {
			// 包络和裸数组必须使用同一资源边界，避免 Provider 只换一种
			// 响应形态就绕过保护。
			throw providerError(
				"Zhongyang outpatient response contained too many records",
				requestId,
			);
		}
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
	verifyTradeStatus(item.tradeStatus, status, requestId);
	// 这里直接复用公开 contract 的上限：异常 provider 文本必须在 adapter
	// 边界被拒绝，不能等到 Elysia 响应校验阶段才变成难定位的 500。
	const billDate = billDateText(item.billDate, requestId);
	const departmentName = textField(
		item.billDeptName,
		"departmentName",
		requestId,
		128,
	);
	const doctorName = textField(item.billDocName, "doctorName", requestId, 128);
	return {
		recordId: opaqueRecordId(item, requestId),
		status,
		...(departmentName ? { departmentName } : {}),
		...(doctorName ? { doctorName } : {}),
		billDate,
		// 2.6.33 只确认 amount 为应收金额；不能根据旧端候选字段
		// waitPayAmount 推导待支付金额，避免将未经 Provider 确认的数值带入公共读模型。
		amountFen: amountFen(item.amount, requestId),
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
			authSysCode: string;
		},
	) {
		this.baseUrl = requiredConfig(options.baseUrl);
		this.authorizationToken = options.authorizationToken?.trim() || undefined;
		// 渠道码会影响 Provider 权限和业务流量归属；adapter 也不能依赖
		// 任何默认值，避免绕过配置 gate 后把请求发到错误业务渠道。
		this.authSysCode = requiredConfig(options.authSysCode);
		this.fetcher = options.fetcher ?? fetch;
	}

	async listRecords(
		input: {
			providerPatientId: string;
			startTime: string;
			endTime: string;
			status: OutpatientPaymentStatus;
		},
		context: AdapterCallContext,
	) {
		if (!isOutpatientPaymentStatus(input.status)) {
			// Provider 查询参数不能把未知值按“非 unpaid”降级为 paid；adapter
			// 也必须独立守住边界，因为它可能被 API 以外的任务直接调用。
			throw new InvalidOutpatientPaymentStatusError();
		}
		// Provider 患者号通常来自 service 的 owner-scoped 映射，但费用
		// adapter 也必须独立拒绝空引用。任务、回放器或错误仓储不能仅凭
		// TypeScript 类型把 `patId=` 发给 Provider；这与预约和报告 adapter
		// 使用同一条患者引用边界。
		const providerPatientId = requiredConfig(input.providerPatientId);
		const url = new URL(OUTPATIENT_PAYMENT_PATH, this.baseUrl);
		url.searchParams.set("patId", providerPatientId);
		url.searchParams.set("startTime", input.startTime);
		url.searchParams.set("endTime", input.endTime);
		url.searchParams.set("tradeStatus", input.status === "unpaid" ? "1" : "3");
		url.searchParams.set("authSysCode", this.authSysCode);
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
	options: ZhongyangGatewayOptions & { authSysCode: string },
): OutpatientPaymentGateway {
	return new ZhongyangOutpatientPaymentApiGateway(options);
}
