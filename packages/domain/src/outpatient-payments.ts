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

/** 门诊费用展示模型；金额统一为人民币分，provider 订单号不进入该模型。 */
export type OutpatientPaymentRecord = {
	recordId: string;
	status: OutpatientPaymentStatus;
	departmentName?: string;
	doctorName?: string;
	billDate: string;
	amountFen: number;
};

/**
 * Provider/网关返回的门诊费用读模型违反公共 contract 时的低敏原因。
 *
 * 原因只用于服务端日志和测试断言，不能直接暴露给患者；尤其不能把
 * Provider 原始字段、单据号或响应正文塞进错误信息。把原因固定为有限枚举，
 * 也能避免后续维护时为了排障再次记录未经脱敏的上游文本。
 */
export type OutpatientPaymentResultViolation =
	| "records-not-array"
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
		const departmentName = optionalPaymentDisplayText(record.departmentName);
		const doctorName = optionalPaymentDisplayText(record.doctorName);
		return {
			recordId,
			status: normalizedStatus,
			...(departmentName !== undefined ? { departmentName } : {}),
			...(doctorName !== undefined ? { doctorName } : {}),
			billDate,
			amountFen,
		};
	});
}

function optionalPaymentDisplayText(value: unknown): string | undefined {
	if (value === undefined) return undefined;
	if (!hasSafeDisplayText(value, 128)) {
		invalidResult("display-text-invalid");
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
}
