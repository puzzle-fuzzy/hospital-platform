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
	parseOutpatientBillDateTime,
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
const OUTPATIENT_PAYMENT_INPUT_FIELDS = new Set([
	"providerPatientId",
	"startTime",
	"endTime",
	"status",
]);

type OutpatientPaymentAdapterInput = {
	providerPatientId: string;
	startTime: string;
	endTime: string;
	status: OutpatientPaymentStatus;
};

/**
 * 2.6.33 费用条目同时包含费用项目、数量、单价、费别和执行信息。这里只读取
 * 患者端确实需要的展示字段；患者/订单标识、医保编码、诊断和原始响应仍留在
 * adapter 内部，不能因为页面需要“更多内容”就整包透传。
 */
type ProviderPaymentItem = {
	amount?: unknown;
	/**
	 * 2.6.33 响应中的订单状态：1=待支付、2=已生成结算、3=已支付、
	 * 4=退款中、5=已退款、9=作废。公共只读模型把 1 映射为待缴费，
	 * 把 3/4 映射到已缴费列表，并用 paymentStatus 标记退款中；其余状态
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
	exeDeptName?: unknown;
	exeDocName?: unknown;
	itemName?: unknown;
	price?: unknown;
	quantity?: unknown;
	unitName?: unknown;
	spec?: unknown;
	chargeClassName?: unknown;
	tradePropName?: unknown;
	networkPatClassName?: unknown;
	typeMemo?: unknown;
	preferentialAmount?: unknown;
	ascendAmount?: unknown;
	selfBurdenRatio?: unknown;
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

function invalidInput(message: string): never {
	// service 层已经生成并校验最近 30 个中国标准时间日窗口，但 adapter
	// 也可能被回放任务、Worker 或未来组合根直接调用。这里拒绝错误输入，
	// 不能让 `undefined`、非法日期或未知字段进入 Provider 查询帧。
	throw providerError(message, undefined, false);
}

/**
 * 门诊费用 adapter 的运行时请求门禁。
 *
 * TypeScript 的 `OutpatientPaymentAdapterInput` 只在编译期存在；直接调用方
 * 仍可能传入 null、未知字段、非法自然日或倒序时间。Provider 接口使用完整
 * 的中国标准时间文本，因此这里将输入收敛为唯一的合法请求形状，保持状态、
 * 患者引用和时间窗口语义与 service 一致。
 */
function normalizeInput(value: unknown): OutpatientPaymentAdapterInput {
	if (typeof value !== "object" || value === null || Array.isArray(value)) {
		return invalidInput("Zhongyang outpatient request input is invalid");
	}
	const record = value as Record<string, unknown>;
	if (
		Object.keys(record).some(
			(field) => !OUTPATIENT_PAYMENT_INPUT_FIELDS.has(field),
		)
	) {
		return invalidInput(
			"Zhongyang outpatient request input contains an unknown field",
		);
	}
	if (typeof record.providerPatientId !== "string") {
		return invalidInput(
			"Zhongyang outpatient provider patient reference is invalid",
		);
	}
	if (!isOutpatientPaymentStatus(record.status)) {
		throw new InvalidOutpatientPaymentStatusError();
	}
	if (
		typeof record.startTime !== "string" ||
		typeof record.endTime !== "string"
	) {
		return invalidInput("Zhongyang outpatient time range is invalid");
	}
	const start = parseOutpatientBillDateTime(record.startTime);
	const end = parseOutpatientBillDateTime(record.endTime);
	if (start === undefined || end === undefined || start > end) {
		return invalidInput("Zhongyang outpatient time range is invalid");
	}
	return {
		providerPatientId: record.providerPatientId,
		startTime: record.startTime,
		endTime: record.endTime,
		status: record.status,
	};
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
	// 不能直接对 unknown 调用 String：JSON 对象/数组可能被隐式转换成
	// 看似合法的金额（例如 `["12.30"]`），带有 `toString` 字段的对象还可能
	// 在转换时抛出原生 TypeError，绕过统一的 Provider 响应异常和低敏日志。
	// Provider 的金额只接受 JSON 字符串或数字，形状异常必须稳定地 fail-closed。
	if (typeof value !== "string" && typeof value !== "number") {
		throw providerError("Zhongyang outpatient amount is invalid", requestId);
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

/** 可选费用金额沿用 amount 的元→分精确转换；缺失字段保持缺省。 */
function optionalAmountFen(
	value: unknown,
	field: string,
	requestId: string,
): number | undefined {
	if (value === undefined || value === null || value === "") return undefined;
	try {
		return amountFen(value, requestId);
	} catch (error) {
		if (error instanceof ProviderRequestError) {
			throw providerError(
				`Zhongyang outpatient ${field} is invalid`,
				requestId,
			);
		}
		throw error;
	}
}

/** 2.6.33 自付比例按 0～1 小数传递，页面只负责百分比格式化。 */
function optionalRatio(
	value: unknown,
	field: string,
	requestId: string,
): number | undefined {
	if (value === undefined || value === null || value === "") return undefined;
	if (typeof value !== "number" && typeof value !== "string") {
		throw providerError(`Zhongyang outpatient ${field} is invalid`, requestId);
	}
	const normalized = String(value).trim();
	if (!/^\d+(?:\.\d+)?$/.test(normalized)) {
		throw providerError(`Zhongyang outpatient ${field} is invalid`, requestId);
	}
	const ratio = Number(normalized);
	if (!Number.isFinite(ratio) || ratio < 0 || ratio > 1) {
		throw providerError(`Zhongyang outpatient ${field} is invalid`, requestId);
	}
	return ratio;
}

/**
 * 校验 Provider 返回的订单状态与本次查询条件一致。
 *
 * 不能只相信请求参数并给整批记录贴上 `unpaid`/`paid` 标签：Provider
 * 可能因为数据错配、查询条件失效或上游返回异常而返回另一种状态。
 * 2.6.33 已明确响应中的 `tradeStatus`。待缴费查询只能收到 1；已缴费
 * 查询允许 3（已支付）和 4（退款中），其中 4 会在公共模型中保留为
 * `paymentStatus: "refunding"`。未知、已退款或作废状态仍必须整批失败，
 * 避免把不可支付或已失效记录伪装成可展示的已缴费事实。
 */
function verifyTradeStatus(
	value: unknown,
	status: OutpatientPaymentStatus,
	requestId: string,
): OutpatientPaymentRecord["paymentStatus"] {
	if (typeof value !== "string" && typeof value !== "number") {
		throw providerError(
			"Zhongyang outpatient tradeStatus is missing or invalid",
			requestId,
		);
	}
	const actual = String(value).trim();
	if (status === "unpaid") {
		if (actual === "1") return undefined;
	} else {
		if (actual === "3") return undefined;
		if (actual === "4") return "refunding";
	}
	throw providerError(
		"Zhongyang outpatient tradeStatus did not match the requested status",
		requestId,
	);
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
		!normalized ||
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
 * 费用记录 ID 必须在不同患者、查询排序和待缴/已缴状态之间保持稳定。
 *
 * 数组下标只能作为渲染辅助，不能进入业务引用：Provider 对同一账单的
 * 返回顺序可能变化，支付后 `tradeStatus` 也会改变。这里使用单据、就诊
 * 和项目标识组成内部哈希；同时把 Provider 患者引用作为哈希作用域，避免
 * 两位患者恰好拥有相同 Provider 单据字段时得到相同的公开 recordId。患者
 * 引用只参与服务端哈希，不进入响应。`itemName` 只是展示文本，不属于稳定
 * 身份，不能作为最后 fallback。缺少单据、就诊或费用 ID 时拒绝响应，避免
 * 把不可定位的费用伪装成可供后续详情/支付使用的 recordId。
 */
function opaqueRecordId(
	item: ProviderPaymentItem,
	providerPatientId: string,
	requestId: string,
): string {
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
	const scopedProviderPatientId = identityText(
		providerPatientId,
		"providerPatientId",
		requestId,
	);
	if (!scopedProviderPatientId) {
		throw providerError(
			"Zhongyang outpatient provider patient identity is missing",
			requestId,
		);
	}
	const canonicalIdentity = [
		// 这是内部作用域，不是要返回给小程序的患者号；把它放进哈希只为
		// 让同一费用字段在不同患者之间不会产生可混淆的 recordId。
		scopedProviderPatientId,
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
	providerPatientId: string,
	status: OutpatientPaymentStatus,
	requestId: string,
): OutpatientPaymentRecord {
	const paymentStatus = verifyTradeStatus(item.tradeStatus, status, requestId);
	// 这里直接复用公开 contract 的上限：异常 provider 文本必须在 adapter
	// 边界被拒绝，不能等到 Elysia 响应校验阶段才变成难定位的 500。
	const billDate = billDateText(item.billDate, requestId);
	const itemName = textField(item.itemName, "itemName", requestId, 256);
	const departmentName = textField(
		item.billDeptName,
		"departmentName",
		requestId,
		128,
	);
	const executionDepartmentName = textField(
		item.exeDeptName,
		"executionDepartmentName",
		requestId,
		128,
	);
	const doctorName = textField(item.billDocName, "doctorName", requestId, 128);
	const executionDoctorName = textField(
		item.exeDocName,
		"executionDoctorName",
		requestId,
		128,
	);
	const spec = textField(item.spec, "spec", requestId, 128);
	const quantity = textField(item.quantity, "quantity", requestId, 64);
	const unitName = textField(item.unitName, "unitName", requestId, 64);
	const priceFen = optionalAmountFen(item.price, "price", requestId);
	const chargeClassName = textField(
		item.chargeClassName,
		"chargeClassName",
		requestId,
		128,
	);
	const tradePropName = textField(
		item.tradePropName,
		"tradePropName",
		requestId,
		128,
	);
	const networkPatClassName = textField(
		item.networkPatClassName,
		"networkPatClassName",
		requestId,
		128,
	);
	const typeMemo = textField(item.typeMemo, "typeMemo", requestId, 128);
	const preferentialAmountFen = optionalAmountFen(
		item.preferentialAmount,
		"preferentialAmount",
		requestId,
	);
	const ascendAmountFen = optionalAmountFen(
		item.ascendAmount,
		"ascendAmount",
		requestId,
	);
	const selfBurdenRatio = optionalRatio(
		item.selfBurdenRatio,
		"selfBurdenRatio",
		requestId,
	);
	return {
		recordId: opaqueRecordId(item, providerPatientId, requestId),
		status,
		...(paymentStatus ? { paymentStatus } : {}),
		...(itemName ? { itemName } : {}),
		...(departmentName ? { departmentName } : {}),
		...(executionDepartmentName ? { executionDepartmentName } : {}),
		...(doctorName ? { doctorName } : {}),
		...(executionDoctorName ? { executionDoctorName } : {}),
		...(spec ? { spec } : {}),
		...(quantity ? { quantity } : {}),
		...(unitName ? { unitName } : {}),
		...(priceFen !== undefined ? { priceFen } : {}),
		...(chargeClassName ? { chargeClassName } : {}),
		...(tradePropName ? { tradePropName } : {}),
		...(networkPatClassName ? { networkPatClassName } : {}),
		...(typeMemo ? { typeMemo } : {}),
		...(preferentialAmountFen !== undefined ? { preferentialAmountFen } : {}),
		...(ascendAmountFen !== undefined ? { ascendAmountFen } : {}),
		...(selfBurdenRatio !== undefined ? { selfBurdenRatio } : {}),
		billDate,
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
		input: OutpatientPaymentAdapterInput,
		context: AdapterCallContext,
	) {
		const normalizedInput = normalizeInput(input);
		// Provider 患者号通常来自 service 的 owner-scoped 映射，但费用
		// adapter 也必须独立拒绝空引用。任务、回放器或错误仓储不能仅凭
		// TypeScript 类型把 `patId=` 发给 Provider；这与预约和报告 adapter
		// 使用同一条患者引用边界。
		const providerPatientId = requiredConfig(normalizedInput.providerPatientId);
		const url = new URL(OUTPATIENT_PAYMENT_PATH, this.baseUrl);
		url.searchParams.set("patId", providerPatientId);
		url.searchParams.set("startTime", normalizedInput.startTime);
		url.searchParams.set("endTime", normalizedInput.endTime);
		url.searchParams.set(
			"tradeStatus",
			normalizedInput.status === "unpaid" ? "1" : "3",
		);
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
			mapRecord(
				item,
				providerPatientId,
				normalizedInput.status,
				response.requestId,
			),
		);
		ensureUniqueRecordIds(records, response.requestId);
		return {
			records,
			trace: trace(response.requestId),
		};
	}

	/**
	 * 支付前重新读取同一门诊待缴清单，并从服务端解析真实的
	 * `outTradeOrderId`。小程序只持有 opaque recordId，绝不直接提交 Provider
	 * 单号或金额。
	 */
	async resolvePaymentContext(
		input: {
			providerPatientId: string;
			recordId: string;
			startTime: string;
			endTime: string;
		},
		context: import("@hospital/domain").AdapterCallContext,
	) {
		const providerPatientId = requiredConfig(input.providerPatientId);
		const recordId = requiredConfig(input.recordId);
		const startTime = requiredConfig(input.startTime);
		const endTime = requiredConfig(input.endTime);
		const url = new URL(OUTPATIENT_PAYMENT_PATH, this.baseUrl);
		url.searchParams.set("patId", providerPatientId);
		url.searchParams.set("startTime", startTime);
		url.searchParams.set("endTime", endTime);
		url.searchParams.set("tradeStatus", "1");
		url.searchParams.set("authSysCode", this.authSysCode);
		const response = await requestJson<unknown>(
			{
				provider: "zhongyang",
				operation: "outpatient-payment-context",
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
		const matched = items.find(
			(item) =>
				opaqueRecordId(item, providerPatientId, response.requestId) ===
				recordId,
		);
		if (!matched) {
			throw providerError(
				"Zhongyang outpatient payment record was not found",
				response.requestId,
				false,
			);
		}
		const outTradeOrderId = identityText(
			matched.outTradeOrderId,
			"outTradeOrderId",
			response.requestId,
		);
		if (!outTradeOrderId) {
			throw providerError(
				"Zhongyang outpatient payment record has no outTradeOrderId",
				response.requestId,
			);
		}
		return {
			recordId,
			providerPatientId,
			outTradeOrderIds: [outTradeOrderId],
			totalFen: amountFen(matched.amount, response.requestId),
			trace: {
				...trace(response.requestId),
				operation: "outpatient-payment-context",
			},
		};
	}
}

export function createZhongyangOutpatientPaymentGateway(
	options: ZhongyangGatewayOptions & { authSysCode: string },
): OutpatientPaymentGateway {
	return new ZhongyangOutpatientPaymentApiGateway(options);
}
