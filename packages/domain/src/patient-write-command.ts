import { isBoundedOpaqueIdentifier } from "./opaque-identifier";

/**
 * D 批次共用的患者/便民写入入口。
 *
 * 这些入口虽然业务内容不同，但都可能产生不可逆副作用：建档、绑卡、
 * 接受协议、提交问卷、上传文件或公开内容。因此先在领域层固定命令
 * 生命周期，后续每个 Provider 只负责自己的 contract，不再各自发明一套
 * “请求失败后要不要重试”的状态语义。
 */
export const PATIENT_WRITE_FEATURES = [
	"patient-binding",
	"patient-agreement",
	"patient-address",
	"patient-qr",
	"patient-signature",
	"admission-preconsultation",
	"discharge-followup",
	"risk-evaluation",
	"health-test",
	"pre-visit",
	"gift-banner",
	"health-praise",
] as const;

export type PatientWriteFeature = (typeof PATIENT_WRITE_FEATURES)[number];

/**
 * 命令状态不是 Provider 状态的翻译表：
 *
 * - `requested`：平台已接受命令意图，但尚未决定是否触发外部副作用；
 * - `awaiting_confirmation`：需要用户或业务侧明确确认，不能自动发送；
 * - `pending`：副作用可能已经发生，超时只能查询最终事实，不能盲目重放；
 * - `submitted`：已取得权威提交成功事实；
 * - `duplicate`：幂等键命中已存在事实，不能再创建一条新命令；
 * - `rejected`：已取得权威拒绝事实，不能把拒绝降级成空成功。
 */
export const PATIENT_WRITE_COMMAND_STATES = [
	"requested",
	"awaiting_confirmation",
	"pending",
	"submitted",
	"duplicate",
	"rejected",
] as const;

export type PatientWriteCommandState =
	(typeof PATIENT_WRITE_COMMAND_STATES)[number];

/** 仓储中最多保留的状态轨迹条数，防止重放/修复操作造成无界增长。 */
export const MAX_PATIENT_WRITE_COMMAND_HISTORY = 16;

export type PatientWriteCommandTransition = {
	/** 初始命令没有前置状态，后续记录必须与上一条的 to 对齐。 */
	from: PatientWriteCommandState | null;
	to: PatientWriteCommandState;
	at: string;
};

export type PatientWriteCommand = {
	/** 服务端生成的 opaque 命令 ID，不接受客户端自定义临床 ID。 */
	commandId: string;
	/** 命令所属平台用户，所有写入都必须在该 owner 范围内执行。 */
	ownerUserId: string;
	/** 可选的内部患者 ID；患者绑定等入口在确认前可以没有目标患者。 */
	patientId?: string;
	feature: PatientWriteFeature;
	/** 幂等键的唯一性由 owner + feature + key 组合维护。 */
	idempotencyKey: string;
	state: PatientWriteCommandState;
	createdAt: string;
	updatedAt: string;
	history: readonly PatientWriteCommandTransition[];
};

export type PatientWriteCommandInput = {
	commandId: string;
	ownerUserId: string;
	patientId?: string;
	feature: PatientWriteFeature;
	idempotencyKey: string;
};

export type PatientWriteCommandViolation =
	| "not-object"
	| "unknown-field"
	| "command-id-invalid"
	| "owner-invalid"
	| "patient-invalid"
	| "feature-invalid"
	| "idempotency-key-invalid"
	| "state-invalid"
	| "timestamp-invalid"
	| "timestamp-order-invalid"
	| "history-invalid"
	| "history-too-long";

/** 运行时材料来自 MySQL/Redis 时，必须再次校验而不能只相信 TypeScript。 */
export class PatientWriteCommandValidationError extends Error {
	readonly violation: PatientWriteCommandViolation;

	constructor(violation: PatientWriteCommandViolation) {
		super("Patient write command is invalid");
		this.name = "PatientWriteCommandValidationError";
		this.violation = violation;
	}
}

/** 只允许沿已冻结的命令状态边迁移。 */
export class InvalidPatientWriteCommandTransitionError extends Error {
	readonly from: PatientWriteCommandState;
	readonly to: PatientWriteCommandState;

	constructor(from: PatientWriteCommandState, to: PatientWriteCommandState) {
		super(`Invalid patient write command transition: ${from} -> ${to}`);
		this.name = "InvalidPatientWriteCommandTransitionError";
		this.from = from;
		this.to = to;
	}
}

/**
 * 未知 Provider 结果不能直接进入 submitted/rejected；调用方应保持 pending，
 * 使用同一个 commandId 做最终状态查询。这条规则不依赖具体 Provider。
 */
const PATIENT_WRITE_COMMAND_TRANSITIONS: Record<
	PatientWriteCommandState,
	readonly PatientWriteCommandState[]
> = {
	requested: ["awaiting_confirmation", "pending", "duplicate", "rejected"],
	awaiting_confirmation: ["pending", "rejected"],
	pending: ["submitted", "duplicate", "rejected"],
	submitted: [],
	duplicate: [],
	rejected: [],
};

const COMMAND_KEYS = new Set([
	"commandId",
	"ownerUserId",
	"patientId",
	"feature",
	"idempotencyKey",
	"state",
	"createdAt",
	"updatedAt",
	"history",
]);

const TRANSITION_KEYS = new Set(["from", "to", "at"]);

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function invalid(violation: PatientWriteCommandViolation): never {
	throw new PatientWriteCommandValidationError(violation);
}

function isPatientWriteFeature(value: unknown): value is PatientWriteFeature {
	return (
		typeof value === "string" &&
		(PATIENT_WRITE_FEATURES as readonly string[]).includes(value)
	);
}

function isPatientWriteCommandState(
	value: unknown,
): value is PatientWriteCommandState {
	return (
		typeof value === "string" &&
		(PATIENT_WRITE_COMMAND_STATES as readonly string[]).includes(value)
	);
}

function parseInstant(value: unknown): number | undefined {
	if (typeof value !== "string") return undefined;
	// 必须带显式时区，避免服务器时区差异改变命令顺序和审计时间。
	if (
		!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/u.test(
			value,
		)
	) {
		return undefined;
	}
	const timestamp = Date.parse(value);
	return Number.isFinite(timestamp) ? timestamp : undefined;
}

function parseTimestamp(value: unknown): number {
	const timestamp = parseInstant(value);
	if (timestamp === undefined) invalid("timestamp-invalid");
	return timestamp;
}

/** 将调用方的 Date 固定成带时区的审计时间，并把 Invalid Date 映射成稳定错误。 */
function formatNow(now: Date): string {
	if (!(now instanceof Date) || !Number.isFinite(now.getTime())) {
		invalid("timestamp-invalid");
	}
	return now.toISOString();
}

function assertAllowedKeys(
	record: Record<string, unknown>,
	keys: Set<string>,
): void {
	for (const key of Object.keys(record)) {
		if (!keys.has(key)) invalid("unknown-field");
	}
}

function assertValidTransition(
	from: PatientWriteCommandState,
	to: PatientWriteCommandState,
): void {
	// 这个函数会被仓储恢复和未来 worker 共同调用，不能只依赖调用方的
	// TypeScript 类型。运行时传入未知状态时，必须返回统一领域校验错误，
	// 而不是对 undefined 调用 includes 产生不可分类的 TypeError。
	if (!isPatientWriteCommandState(from) || !isPatientWriteCommandState(to)) {
		invalid("state-invalid");
	}
	if (!PATIENT_WRITE_COMMAND_TRANSITIONS[from].includes(to)) {
		throw new InvalidPatientWriteCommandTransitionError(from, to);
	}
}

function assertValidHistory(
	history: unknown,
	createdAt: number,
	updatedAt: number,
	state: PatientWriteCommandState,
): PatientWriteCommandTransition[] {
	if (!Array.isArray(history) || history.length === 0)
		invalid("history-invalid");
	if (history.length > MAX_PATIENT_WRITE_COMMAND_HISTORY)
		invalid("history-too-long");

	const normalized: PatientWriteCommandTransition[] = [];
	let previousAt = createdAt;
	for (const [index, value] of history.entries()) {
		if (!isRecord(value)) invalid("history-invalid");
		assertAllowedKeys(value, TRANSITION_KEYS);
		const from = value.from === null ? null : value.from;
		if (from !== null && !isPatientWriteCommandState(from)) {
			invalid("history-invalid");
		}
		if (!isPatientWriteCommandState(value.to)) invalid("history-invalid");
		const at = parseTimestamp(value.at);
		if (at < previousAt) invalid("timestamp-order-invalid");
		if (index === 0) {
			if (from !== null || value.to !== "requested" || at !== createdAt) {
				invalid("history-invalid");
			}
		} else {
			const previous = normalized[index - 1];
			if (!previous) invalid("history-invalid");
			if (from !== previous.to) invalid("history-invalid");
			assertValidTransition(from, value.to);
		}
		normalized.push({
			from,
			to: value.to,
			at: value.at as string,
		});
		previousAt = at;
	}

	const last = normalized[normalized.length - 1];
	if (!last) invalid("history-invalid");
	if (last.to !== state || previousAt !== updatedAt) {
		invalid("timestamp-order-invalid");
	}
	return normalized;
}

/**
 * 对仓储/队列返回的命令做严格归一化。
 *
 * 这里不接受 payload、providerId、姓名、证件号或原始报文等扩展字段；
 * 写入内容必须由各业务自己的受限 contract 管理，不能借命令状态机绕过
 * 字段白名单和患者归属审计。
 */
export function normalizePatientWriteCommand(
	value: unknown,
): PatientWriteCommand {
	if (!isRecord(value)) invalid("not-object");
	assertAllowedKeys(value, COMMAND_KEYS);
	if (!isBoundedOpaqueIdentifier(value.commandId))
		invalid("command-id-invalid");
	if (!isBoundedOpaqueIdentifier(value.ownerUserId)) invalid("owner-invalid");
	if (
		value.patientId !== undefined &&
		!isBoundedOpaqueIdentifier(value.patientId)
	) {
		invalid("patient-invalid");
	}
	if (!isPatientWriteFeature(value.feature)) invalid("feature-invalid");
	if (!isBoundedOpaqueIdentifier(value.idempotencyKey))
		invalid("idempotency-key-invalid");
	if (!isPatientWriteCommandState(value.state)) invalid("state-invalid");
	const createdAt = parseTimestamp(value.createdAt);
	const updatedAt = parseTimestamp(value.updatedAt);
	if (updatedAt < createdAt) invalid("timestamp-order-invalid");
	const history = assertValidHistory(
		value.history,
		createdAt,
		updatedAt,
		value.state,
	);

	return {
		commandId: value.commandId,
		ownerUserId: value.ownerUserId,
		...(value.patientId !== undefined ? { patientId: value.patientId } : {}),
		feature: value.feature,
		idempotencyKey: value.idempotencyKey,
		state: value.state,
		createdAt: value.createdAt as string,
		updatedAt: value.updatedAt as string,
		history,
	};
}

/** 创建命令只进入 requested，不能在构造函数中伪造 Provider 成功。 */
export function createPatientWriteCommand(
	input: PatientWriteCommandInput,
	now = new Date(),
): PatientWriteCommand {
	const at = formatNow(now);
	return normalizePatientWriteCommand({
		...input,
		state: "requested",
		createdAt: at,
		updatedAt: at,
		history: [{ from: null, to: "requested", at }],
	});
}

export function canTransitionPatientWriteCommand(
	from: PatientWriteCommandState,
	to: PatientWriteCommandState,
): boolean {
	if (!isPatientWriteCommandState(from) || !isPatientWriteCommandState(to)) {
		return false;
	}
	return PATIENT_WRITE_COMMAND_TRANSITIONS[from].includes(to);
}

export function allowedPatientWriteCommandTransitions(
	from: PatientWriteCommandState,
): readonly PatientWriteCommandState[] {
	return PATIENT_WRITE_COMMAND_TRANSITIONS[from];
}

/**
 * 推进命令并追加不可变轨迹。
 *
 * `pending` 不允许由调用方自动改回 `requested`，终态也没有回退边；因此
 * 网络超时、进程重启或重复点击只能沿 commandId 做查询/对账，不能再次
 * 触发可能已经产生副作用的建档、绑卡、提交或上传。
 */
export function transitionPatientWriteCommand(
	value: unknown,
	to: PatientWriteCommandState,
	now = new Date(),
): PatientWriteCommand {
	const command = normalizePatientWriteCommand(value);
	assertValidTransition(command.state, to);
	const at = formatNow(now);
	const currentAt = parseTimestamp(command.updatedAt);
	if (Date.parse(at) < currentAt) invalid("timestamp-order-invalid");
	const history = [...command.history, { from: command.state, to, at }];
	if (history.length > MAX_PATIENT_WRITE_COMMAND_HISTORY)
		invalid("history-too-long");
	return normalizePatientWriteCommand({
		...command,
		state: to,
		updatedAt: at,
		history,
	});
}

export function isPatientWriteCommandTerminal(
	state: PatientWriteCommandState,
): boolean {
	return state === "submitted" || state === "duplicate" || state === "rejected";
}
