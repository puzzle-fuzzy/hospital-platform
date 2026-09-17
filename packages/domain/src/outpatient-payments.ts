import { isBoundedOpaqueIdentifier } from "./opaque-identifier";
import type { AdapterCallContext, ExternalTrace } from "./ports";

/** 门诊费用列表只表达查询状态，不把 provider 数字状态码带到客户端。 */
export type OutpatientPaymentStatus = "unpaid" | "paid";

/**
 * 门诊费用查询状态的运行时边界错误。
 *
 * TypeScript 只能约束编译期调用方；HTTP 解析器之外的任务、测试或未来模块
 * 仍可能在运行时传入任意字符串。状态一旦越过领域边界，就可能被错误解释为
 * Provider 的“已支付”查询，因此必须在领域层显式拒绝，而不是依赖类型断言。
 */
export class InvalidOutpatientPaymentStatusError extends Error {
	constructor() {
		super("Invalid outpatient payment status");
		this.name = "InvalidOutpatientPaymentStatusError";
	}
}

/** 供 API、service 和 adapter 共用的门诊费用状态运行时守卫。 */
export function isOutpatientPaymentStatus(
	value: unknown,
): value is OutpatientPaymentStatus {
	return value === "unpaid" || value === "paid";
}

/**
 * 门诊费用展示模型；金额统一为人民币分，provider 订单号、患者标识和医保编码
 * 不进入该模型。字段均来自 2.6.33 的费用条目，展示字段保持可选以兼容不同
 * 费用类型（药品、检查、材料和挂号费）返回的空字段。
 */
export type OutpatientPaymentRecord = {
	recordId: string;
	status: OutpatientPaymentStatus;
	/** Provider tradeStatus=4；仍属于已缴费查询结果，但资金正在退款。 */
	paymentStatus?: "refunding";
	itemName?: string;
	departmentName?: string;
	executionDepartmentName?: string;
	doctorName?: string;
	executionDoctorName?: string;
	spec?: string;
	quantity?: string;
	unitName?: string;
	priceFen?: number;
	chargeClassName?: string;
	tradePropName?: string;
	networkPatClassName?: string;
	typeMemo?: string;
	preferentialAmountFen?: number;
	ascendAmountFen?: number;
	selfBurdenRatio?: number;
	billDate: string;
	amountFen: number;
};

/**
 * 门诊支付前由服务端解析出的 Provider 事实。
 * `recordId` 只是平台给小程序的 opaque 引用；真正提交 2.6.65.1 的
 * `outTradeOrderIds` 必须由同一次 2.6.33 查询在服务端解析。
 */
export type OutpatientPaymentProviderContext = {
	recordId: string;
	providerPatientId: string;
	outTradeOrderIds: readonly string[];
	totalFen: number;
	trace: ExternalTrace;
};

/**
 * 单次门诊费用只读响应的资源上限。
 *
 * 这是平台防御异常响应的上限，不是患者实际费用条数上限，也不是 Provider
 * 分页合同。超过上限时必须整批拒绝，不能截断后把不完整账单伪装成成功；等
 * Provider 正式分页契约到达后，再设计有界分页合并和总量语义。
 */
export const MAX_OUTPATIENT_PAYMENT_RECORDS = 512;

/**
 * Provider/网关返回的门诊费用读模型违反公共 contract 时的低敏原因。
 *
 * 原因只用于服务端日志和测试断言，不能直接暴露给患者；尤其不能把
 * Provider 原始字段、单据号或响应正文塞进错误信息。把原因固定为有限枚举，
 * 也能避免后续维护时为了排障再次记录未经脱敏的上游文本。
 */
export type OutpatientPaymentResultViolation =
	| "records-not-array"
	| "records-too-many"
	| "record-not-object"
	| "status-mismatch"
	| "record-id-invalid"
	| "record-id-duplicate"
	| "bill-date-invalid"
	| "bill-date-outside-query"
	| "amount-invalid"
	| "display-text-invalid";

/**
 * 网关结果二次校验错误。
 *
 * adapter 已经是第一道 Provider 白名单边界，但 `OutpatientPaymentGateway`
 * 是可注入的端口，未来可能接入真实网关、回放网关或任务实现。服务层不能
 * 因为 TypeScript 类型已经存在，就把任何实现返回的对象当成事实；否则错
 * 状态会进入患者端，重复 ID 还会破坏后续详情/支付引用。这个错误属于
 * Provider 响应异常，而不是患者查询参数错误。
 */
export class OutpatientPaymentResultValidationError extends Error {
	readonly violation: OutpatientPaymentResultViolation;

	constructor(violation: OutpatientPaymentResultViolation) {
		super("Outpatient payment provider result is invalid");
		this.name = "OutpatientPaymentResultValidationError";
		this.violation = violation;
	}
}

function hasSafeDisplayText(
	value: unknown,
	maxLength: number,
): value is string {
	return (
		typeof value === "string" &&
		value.length > 0 &&
		value.length <= maxLength &&
		value === value.trim() &&
		!Array.from(value).some((character) => {
			const code = character.charCodeAt(0);
			return code <= 0x1f || code === 0x7f;
		})
	);
}

function invalidResult(violation: OutpatientPaymentResultViolation): never {
	throw new OutpatientPaymentResultValidationError(violation);
}

/**
 * 严格解析众阳门诊费用使用的中国标准时间文本。
 *
 * `Date.parse` 会把部分非法日期自动进位，例如把 2 月 31 日解释成 3 月的
 * 某一天，因此不能用它直接判断 Provider 事实。这里先校验自然日和时分秒，
 * 再将没有时区后缀的 Provider 文本放到 UTC 伪时间轴上；调用方只用返回值
 * 做窗口比较，不会把这个值当作患者端日期展示。
 */
export function parseOutpatientBillDateTime(value: string): number | undefined {
	const match = /^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2}):(\d{2})$/.exec(value);
	if (!match) return undefined;
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
		return undefined;
	}

	const pseudoUtc = new Date(0);
	pseudoUtc.setUTCHours(hour, minute, second, 0);
	pseudoUtc.setUTCFullYear(year, month - 1, day);
	return pseudoUtc.getTime();
}

/**
 * 在 API service 输出 `loaded` 日志和响应前，重新验证网关给出的公共读模型。
 *
 * 这里不重复解释 Provider 数字状态，只验证已经归一化后的公开状态必须与
 * 本次查询一致。金额、账单时间、展示文本和 opaque ID 也必须保持可序列化、
 * 可渲染、可关联；任一条失败都整批拒绝，不能过滤坏行后把剩余行伪装成完整
 * 结果，更不能返回成功空列表。
 */
export function normalizeOutpatientPaymentRecords(
	value: unknown,
	expectedStatus: OutpatientPaymentStatus,
): OutpatientPaymentRecord[] {
	if (!Array.isArray(value)) invalidResult("records-not-array");
	if (value.length > MAX_OUTPATIENT_PAYMENT_RECORDS) {
		// 不能在这里 slice：调用方看到的 total 和页面列表会变成“看似成功但
		// 实际缺项”的错误事实。这个门禁同时保护回放网关和绕过 adapter 的内部任务。
		invalidResult("records-too-many");
	}

	const recordIds = new Set<string>();
	return value.map((item) => {
		if (typeof item !== "object" || item === null || Array.isArray(item)) {
			invalidResult("record-not-object");
		}
		const record = item as Record<string, unknown>;
		const status = record.status;
		const normalizedStatus: OutpatientPaymentStatus =
			status === "unpaid" || status === "paid"
				? status
				: invalidResult("status-mismatch");
		if (normalizedStatus !== expectedStatus) {
			invalidResult("status-mismatch");
		}
		const paymentStatus = record.paymentStatus;
		if (
			paymentStatus !== undefined &&
			(paymentStatus !== "refunding" || normalizedStatus !== "paid")
		) {
			invalidResult("status-mismatch");
		}
		const recordId = record.recordId;
		if (!isBoundedOpaqueIdentifier(recordId)) {
			invalidResult("record-id-invalid");
		}
		if (recordIds.has(recordId)) {
			invalidResult("record-id-duplicate");
		}
		recordIds.add(recordId);
		const billDate = hasSafeDisplayText(record.billDate, 64)
			? record.billDate
			: invalidResult("bill-date-invalid");
		if (parseOutpatientBillDateTime(billDate) === undefined) {
			invalidResult("bill-date-invalid");
		}
		const amountFen = record.amountFen;
		if (
			typeof amountFen !== "number" ||
			!Number.isSafeInteger(amountFen) ||
			amountFen < 0
		) {
			invalidResult("amount-invalid");
		}
		const itemName = optionalPaymentDisplayText(record.itemName, 256);
		const departmentName = optionalPaymentDisplayText(record.departmentName);
		const executionDepartmentName = optionalPaymentDisplayText(
			record.executionDepartmentName,
		);
		const doctorName = optionalPaymentDisplayText(record.doctorName);
		const executionDoctorName = optionalPaymentDisplayText(
			record.executionDoctorName,
		);
		const spec = optionalPaymentDisplayText(record.spec);
		const quantity = optionalPaymentDisplayText(record.quantity, 64);
		const unitName = optionalPaymentDisplayText(record.unitName, 64);
		const priceFen = optionalPaymentAmountFen(record.priceFen);
		const chargeClassName = optionalPaymentDisplayText(record.chargeClassName);
		const tradePropName = optionalPaymentDisplayText(record.tradePropName);
		const networkPatClassName = optionalPaymentDisplayText(
			record.networkPatClassName,
		);
		const typeMemo = optionalPaymentDisplayText(record.typeMemo);
		const preferentialAmountFen = optionalPaymentAmountFen(
			record.preferentialAmountFen,
		);
		const ascendAmountFen = optionalPaymentAmountFen(record.ascendAmountFen);
		const selfBurdenRatio = optionalPaymentRatio(record.selfBurdenRatio);
		return {
			recordId,
			status: normalizedStatus,
			...(paymentStatus !== undefined ? { paymentStatus } : {}),
			...(itemName !== undefined ? { itemName } : {}),
			...(departmentName !== undefined ? { departmentName } : {}),
			...(executionDepartmentName !== undefined
				? { executionDepartmentName }
				: {}),
			...(doctorName !== undefined ? { doctorName } : {}),
			...(executionDoctorName !== undefined ? { executionDoctorName } : {}),
			...(spec !== undefined ? { spec } : {}),
			...(quantity !== undefined ? { quantity } : {}),
			...(unitName !== undefined ? { unitName } : {}),
			...(priceFen !== undefined ? { priceFen } : {}),
			...(chargeClassName !== undefined ? { chargeClassName } : {}),
			...(tradePropName !== undefined ? { tradePropName } : {}),
			...(networkPatClassName !== undefined ? { networkPatClassName } : {}),
			...(typeMemo !== undefined ? { typeMemo } : {}),
			...(preferentialAmountFen !== undefined ? { preferentialAmountFen } : {}),
			...(ascendAmountFen !== undefined ? { ascendAmountFen } : {}),
			...(selfBurdenRatio !== undefined ? { selfBurdenRatio } : {}),
			billDate,
			amountFen,
		};
	});
}

function optionalPaymentDisplayText(
	value: unknown,
	maxLength = 128,
): string | undefined {
	if (value === undefined) return undefined;
	if (!hasSafeDisplayText(value, maxLength)) {
		invalidResult("display-text-invalid");
	}
	return value;
}

/** 可选金额仍必须按人民币分保存，不能把缺失金额静默当作 0 元。 */
function optionalPaymentAmountFen(value: unknown): number | undefined {
	if (value === undefined) return undefined;
	if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
		invalidResult("amount-invalid");
	}
	return value;
}

/** 2.6.33 自付比例按 0～1 的小数保存，页面再格式化为百分比。 */
function optionalPaymentRatio(value: unknown): number | undefined {
	if (value === undefined) return undefined;
	if (
		typeof value !== "number" ||
		!Number.isFinite(value) ||
		value < 0 ||
		value > 1
	) {
		invalidResult("amount-invalid");
	}
	return value;
}

/** 兼容只需要断言的调用方；新 service 应优先消费重新投影后的数组。 */
export function validateOutpatientPaymentRecords(
	value: unknown,
	expectedStatus: OutpatientPaymentStatus,
): asserts value is readonly OutpatientPaymentRecord[] {
	normalizeOutpatientPaymentRecords(value, expectedStatus);
}

/**
 * 门诊费用 provider 只读网关；写入、医保和微信支付另建独立 contract。
 * 渠道码属于 adapter 的启动配置，不属于单次患者查询参数，避免调用方
 * 在运行时把请求导向未经确认的 Provider 业务渠道。
 */
export interface OutpatientPaymentGateway {
	listRecords(
		input: {
			providerPatientId: string;
			startTime: string;
			endTime: string;
			status: OutpatientPaymentStatus;
		},
		context: AdapterCallContext,
	): Promise<{
		records: readonly OutpatientPaymentRecord[];
		trace: ExternalTrace;
	}>;
	/** 门诊支付入口使用的服务端 Provider 事实解析；未实现时保持关闭。 */
	resolvePaymentContext?(
		input: {
			providerPatientId: string;
			recordId: string;
			startTime: string;
			endTime: string;
		},
		context: AdapterCallContext,
	): Promise<OutpatientPaymentProviderContext>;
}
