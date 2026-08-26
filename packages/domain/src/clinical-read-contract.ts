import { parseStrictIsoInstant } from "./date-range";
import { isBoundedOpaqueIdentifier } from "./opaque-identifier";

/**
 * C 批次的四条临床只读线必须保持业务边界独立。
 *
 * 这里的 feature 只是平台内部路由分类，不是旧 Provider 的接口名；新接入
 * 任意一条线时仍必须提供各自的请求/响应 contract，不能因为共享这个结果
 * 摘要就把病历、住院、医生关系和电子导诊单混成一个通用模型。
 */
export const CLINICAL_READ_FEATURES = [
	"medical-record",
	"inpatient-center",
	"doctor",
	"electronic-consultation",
] as const;

export type ClinicalReadFeature = (typeof CLINICAL_READ_FEATURES)[number];

/**
 * 临床只读查询的统一结果状态。
 *
 * `empty` 是 Provider 明确返回“合法无记录”，与 `rejected`、`unavailable`
 * 严格区分；后两者不能被页面渲染成空列表，更不能覆盖掉上一次已确认的
 * 临床内容。当前只保存摘要，具体条目由各业务域自己的 contract 定义。
 */
export const CLINICAL_READ_STATES = [
	"ready",
	"empty",
	"rejected",
	"unavailable",
] as const;

export type ClinicalReadState = (typeof CLINICAL_READ_STATES)[number];

/** Provider 失败只允许落到固定低敏原因，原始报文不得进入领域结果。 */
export const CLINICAL_READ_ERROR_CODES = [
	"forbidden",
	"provider-rejected",
	"provider-timeout",
	"provider-unavailable",
	"invalid-source",
] as const;

export type ClinicalReadErrorCode = (typeof CLINICAL_READ_ERROR_CODES)[number];

export type ClinicalReadResult = {
	feature: ClinicalReadFeature;
	/** 内部平台用户作用域，Provider 用户号不能由客户端提交到这里。 */
	ownerUserId: string;
	/** 当前明确选择的内部患者，不允许省略后由服务端“取当前人”。 */
	patientId: string;
	state: ClinicalReadState;
	/** ready 时表示已规范化条目数量；其余状态必须为 0。 */
	itemCount: number;
	/** Provider/adapter contract 的内部版本，不能写完整 URL 或原始响应。 */
	sourceVersion: string;
	/** 服务端确认这个结果的时间，必须带显式时区。 */
	observedAt: string;
	errorCode?: ClinicalReadErrorCode;
};

export type ClinicalReadResultViolation =
	| "not-object"
	| "unknown-field"
	| "feature-invalid"
	| "owner-invalid"
	| "patient-invalid"
	| "state-invalid"
	| "item-count-invalid"
	| "source-version-invalid"
	| "timestamp-invalid"
	| "error-code-invalid"
	| "state-count-mismatch"
	| "error-code-mismatch";

/** 结果材料损坏时只暴露固定原因，不携带患者或 Provider 字段。 */
export class ClinicalReadResultValidationError extends Error {
	readonly violation: ClinicalReadResultViolation;

	constructor(violation: ClinicalReadResultViolation) {
		super("Clinical read result is invalid");
		this.name = "ClinicalReadResultValidationError";
		this.violation = violation;
	}
}

const CLINICAL_READ_RESULT_KEYS = new Set([
	"feature",
	"ownerUserId",
	"patientId",
	"state",
	"itemCount",
	"sourceVersion",
	"observedAt",
	"errorCode",
]);

const MAX_CLINICAL_READ_ITEMS = 10_000;
const SOURCE_VERSION_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/u;

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function invalid(violation: ClinicalReadResultViolation): never {
	throw new ClinicalReadResultValidationError(violation);
}

function parseInstant(value: unknown): string | undefined {
	if (typeof value !== "string") return undefined;
	// 临床结果的时间不能依赖运行机器时区，也不能接受自动进位的非法日期，
	// 否则跨服务排序和页面验收会引用不同的观察事实。
	return parseStrictIsoInstant(value) === undefined ? undefined : value;
}

function isClinicalReadFeature(value: unknown): value is ClinicalReadFeature {
	return (
		typeof value === "string" &&
		(CLINICAL_READ_FEATURES as readonly string[]).includes(value)
	);
}

function isClinicalReadState(value: unknown): value is ClinicalReadState {
	return (
		typeof value === "string" &&
		(CLINICAL_READ_STATES as readonly string[]).includes(value)
	);
}

function isClinicalReadErrorCode(
	value: unknown,
): value is ClinicalReadErrorCode {
	return (
		typeof value === "string" &&
		(CLINICAL_READ_ERROR_CODES as readonly string[]).includes(value)
	);
}

/** 来源版本不是通用资源引用，禁止把 URL、路径或 query 当作版本号。 */
function isBoundedSourceVersion(value: unknown): value is string {
	return typeof value === "string" && SOURCE_VERSION_PATTERN.test(value);
}

function assertAllowedKeys(record: Record<string, unknown>): void {
	for (const key of Object.keys(record)) {
		if (!CLINICAL_READ_RESULT_KEYS.has(key)) invalid("unknown-field");
	}
}

/**
 * 统一校验四条临床只读线返回的“结果摘要”。
 *
 * 这不是完整临床数据模型，也不会检查各 Provider 的条目字段；各域必须
 * 在自己的 adapter 中先完成字段白名单和脱敏，再把规范化后的数量/状态交
 * 给这里。这样共享的是作用域和状态不变量，而不是偷用一个万能病历模型。
 */
export function normalizeClinicalReadResult(
	value: unknown,
): ClinicalReadResult {
	if (!isRecord(value)) invalid("not-object");
	assertAllowedKeys(value);
	if (!isClinicalReadFeature(value.feature)) invalid("feature-invalid");
	if (!isBoundedOpaqueIdentifier(value.ownerUserId)) invalid("owner-invalid");
	if (!isBoundedOpaqueIdentifier(value.patientId)) invalid("patient-invalid");
	if (!isClinicalReadState(value.state)) invalid("state-invalid");
	if (
		typeof value.itemCount !== "number" ||
		!Number.isInteger(value.itemCount) ||
		value.itemCount < 0 ||
		value.itemCount > MAX_CLINICAL_READ_ITEMS
	) {
		invalid("item-count-invalid");
	}
	if (!isBoundedSourceVersion(value.sourceVersion)) {
		invalid("source-version-invalid");
	}
	const observedAt = parseInstant(value.observedAt);
	if (!observedAt) invalid("timestamp-invalid");
	const errorCode = value.errorCode;
	if (errorCode !== undefined && !isClinicalReadErrorCode(errorCode)) {
		invalid("error-code-invalid");
	}
	if (value.state === "ready" && value.itemCount === 0) {
		invalid("state-count-mismatch");
	}
	if (value.state !== "ready" && value.itemCount !== 0) {
		invalid("state-count-mismatch");
	}
	if (
		(value.state === "rejected" || value.state === "unavailable") !==
		(errorCode !== undefined)
	) {
		invalid("error-code-mismatch");
	}
	if ((value.state === "ready" || value.state === "empty") && errorCode) {
		invalid("error-code-mismatch");
	}

	return {
		feature: value.feature,
		ownerUserId: value.ownerUserId,
		patientId: value.patientId,
		state: value.state,
		itemCount: value.itemCount,
		sourceVersion: value.sourceVersion,
		observedAt,
		...(errorCode !== undefined ? { errorCode } : {}),
	};
}

/**
 * 供 adapter 在已完成各自字段校验后生成统一摘要。
 *
 * rejected/unavailable 必须带固定错误码；调用方不能为了展示空页面而把
 * Provider 超时包装成 `empty`。这条规则让四个临床入口的失败语义一致。
 */
export function createClinicalReadResult(
	input: ClinicalReadResult,
): ClinicalReadResult {
	return normalizeClinicalReadResult(input);
}
