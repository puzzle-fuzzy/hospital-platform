import { isBoundedOpaqueIdentifier } from "./opaque-identifier";

/**
 * 外部入口只允许使用预先登记的受众。
 *
 * 这里的 audience 不是 Provider 的接口参数，也不是可由客户端提交的字符串；
 * 它是平台内部用来隔离互联网医院、客服、问诊、报告资源等主体的安全边界。
 * 新增外部主体时必须先登记 contract，不能通过传入一个新的字符串绕过门禁。
 */
export const EXTERNAL_ENTRY_AUDIENCES = [
	"internet-hospital",
	"smart-guide",
	"smart-customer",
	"consultation",
	"companion",
	"patient-subscription",
	"report-cloud-image",
	"report-share",
	"report-follow-up",
] as const;

export type ExternalEntryAudience = (typeof EXTERNAL_ENTRY_AUDIENCES)[number];

/**
 * 平台对外部入口会话设置的最长有效期。
 *
 * 这是平台安全上限，不代表任何外部 Provider 的正式 TTL；Provider contract
 * 只能进一步收紧，不能在没有安全评审的情况下把有效期扩大。会话引用本身
 * 仍应由持久化层保存哈希或不可逆索引，不能把 JWT/平台 access token 放进去。
 */
export const MAX_EXTERNAL_ENTRY_SESSION_TTL_MS = 10 * 60 * 1000;

/** 外部入口会话只允许三种可审计状态；过期由时间判断，不另存一个易漂移的状态。 */
export type ExternalEntrySessionStatus = "issued" | "consumed" | "revoked";

export type ExternalEntrySession = {
	/** 平台生成的 opaque 引用，不是 bearer token，也不包含 Provider ID。 */
	sessionId: string;
	/** 会话所属的平台用户；外部主体不能自行指定 owner。 */
	ownerUserId: string;
	/** 患者范围入口必须精确绑定患者；无患者范围的入口不应偷偷扩大为患者会话。 */
	patientId?: string;
	audience: ExternalEntryAudience;
	/** 平台内部登记的资源 key，不接受完整 URL、path 或 query。 */
	resourceKey: string;
	/** 最小权限 scope 只作平台内部授权摘要，不允许携带 Provider 原始权限字段。 */
	scope: readonly string[];
	issuedAt: string;
	expiresAt: string;
	status: ExternalEntrySessionStatus;
	consumedAt?: string;
	revokedAt?: string;
};

export type ExternalEntrySessionConsumeContext = {
	ownerUserId: string;
	patientId?: string;
	audience: ExternalEntryAudience;
	resourceKey: string;
	now: Date;
};

export type ExternalEntrySessionRejectionReason =
	| "expired"
	| "revoked"
	| "consumed"
	| "owner-mismatch"
	| "patient-scope-mismatch"
	| "audience-mismatch"
	| "resource-mismatch";

export type ExternalEntrySessionDecision =
	| { allowed: true; session: ExternalEntrySession }
	| { allowed: false; reason: ExternalEntrySessionRejectionReason };

export type ExternalEntrySessionViolation =
	| "not-object"
	| "unknown-field"
	| "session-id-invalid"
	| "owner-invalid"
	| "patient-invalid"
	| "audience-invalid"
	| "resource-invalid"
	| "scope-invalid"
	| "timestamp-invalid"
	| "timestamp-order-invalid"
	| "ttl-too-long"
	| "status-invalid"
	| "consumed-at-invalid"
	| "revoked-at-invalid";

/** 运行时材料损坏时返回固定原因，不能把 session 值带入异常或日志。 */
export class ExternalEntrySessionValidationError extends Error {
	readonly violation: ExternalEntrySessionViolation;

	constructor(violation: ExternalEntrySessionViolation) {
		super("External entry session is invalid");
		this.name = "ExternalEntrySessionValidationError";
		this.violation = violation;
	}
}

/** 消费失败属于明确的业务拒绝，调用层可以映射为统一的短期会话错误。 */
export class ExternalEntrySessionConsumeError extends Error {
	readonly reason: ExternalEntrySessionRejectionReason;

	constructor(reason: ExternalEntrySessionRejectionReason) {
		super("External entry session cannot be consumed");
		this.name = "ExternalEntrySessionConsumeError";
		this.reason = reason;
	}
}

const SESSION_KEYS = new Set([
	"sessionId",
	"ownerUserId",
	"patientId",
	"audience",
	"resourceKey",
	"scope",
	"issuedAt",
	"expiresAt",
	"status",
	"consumedAt",
	"revokedAt",
]);

const SESSION_SCOPE_MAX_ITEMS = 16;

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function invalid(violation: ExternalEntrySessionViolation): never {
	throw new ExternalEntrySessionValidationError(violation);
}

function isAudience(value: unknown): value is ExternalEntryAudience {
	return (
		typeof value === "string" &&
		(EXTERNAL_ENTRY_AUDIENCES as readonly string[]).includes(value)
	);
}

function parseInstant(value: unknown): number | undefined {
	if (typeof value !== "string") return undefined;
	// 必须带显式时区，避免开发机本地时区让会话有效期产生歧义。
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

function assertAllowedKeys(record: Record<string, unknown>): void {
	for (const key of Object.keys(record)) {
		if (!SESSION_KEYS.has(key)) invalid("unknown-field");
	}
}

function parseOptionalOpaqueIdentifier(
	value: unknown,
	violation: "patient-invalid",
): string | undefined {
	if (value === undefined) return undefined;
	if (!isBoundedOpaqueIdentifier(value)) invalid(violation);
	return value;
}

function parseTimestamp(
	value: unknown,
	violation: "timestamp-invalid" | "consumed-at-invalid" | "revoked-at-invalid",
): number {
	const timestamp = parseInstant(value);
	if (timestamp === undefined) invalid(violation);
	return timestamp;
}

function parseStatus(value: unknown): ExternalEntrySessionStatus {
	if (value !== "issued" && value !== "consumed" && value !== "revoked") {
		invalid("status-invalid");
	}
	return value;
}

/**
 * 对仓储、缓存或未来 worker 返回的会话做二次运行时校验。
 *
 * TypeScript 类型不能证明 Redis/MySQL 中的对象没有被旧版本写坏；这里必须
 * 拒绝未知字段和不完整终态，避免过期/重放/跨患者会话在后续服务层被当成
 * 合法 ticket。这个函数不记录或返回任何 Provider 原始字段。
 */
export function normalizeExternalEntrySession(
	value: unknown,
): ExternalEntrySession {
	if (!isRecord(value)) invalid("not-object");
	assertAllowedKeys(value);
	if (!isBoundedOpaqueIdentifier(value.sessionId))
		invalid("session-id-invalid");
	if (!isBoundedOpaqueIdentifier(value.ownerUserId)) invalid("owner-invalid");
	const patientId = parseOptionalOpaqueIdentifier(
		value.patientId,
		"patient-invalid",
	);
	if (!isAudience(value.audience)) invalid("audience-invalid");
	if (!isBoundedOpaqueIdentifier(value.resourceKey))
		invalid("resource-invalid");
	if (
		!Array.isArray(value.scope) ||
		value.scope.length === 0 ||
		value.scope.length > SESSION_SCOPE_MAX_ITEMS ||
		value.scope.some((item) => !isBoundedOpaqueIdentifier(item))
	) {
		invalid("scope-invalid");
	}
	const issuedAt = parseTimestamp(value.issuedAt, "timestamp-invalid");
	const expiresAt = parseTimestamp(value.expiresAt, "timestamp-invalid");
	if (expiresAt <= issuedAt) invalid("timestamp-order-invalid");
	if (expiresAt - issuedAt > MAX_EXTERNAL_ENTRY_SESSION_TTL_MS) {
		invalid("ttl-too-long");
	}
	const status = parseStatus(value.status);
	const consumedAt =
		value.consumedAt === undefined
			? undefined
			: parseTimestamp(value.consumedAt, "consumed-at-invalid");
	const revokedAt =
		value.revokedAt === undefined
			? undefined
			: parseTimestamp(value.revokedAt, "revoked-at-invalid");
	if (status === "consumed" && consumedAt === undefined) {
		invalid("consumed-at-invalid");
	}
	if (status !== "consumed" && consumedAt !== undefined) {
		invalid("consumed-at-invalid");
	}
	if (status === "revoked" && revokedAt === undefined) {
		invalid("revoked-at-invalid");
	}
	if (status !== "revoked" && revokedAt !== undefined) {
		invalid("revoked-at-invalid");
	}

	return {
		sessionId: value.sessionId,
		ownerUserId: value.ownerUserId,
		...(patientId !== undefined ? { patientId } : {}),
		audience: value.audience,
		resourceKey: value.resourceKey,
		scope: [...value.scope],
		issuedAt: value.issuedAt as string,
		expiresAt: value.expiresAt as string,
		status,
		...(consumedAt !== undefined
			? { consumedAt: value.consumedAt as string }
			: {}),
		...(revokedAt !== undefined
			? { revokedAt: value.revokedAt as string }
			: {}),
	};
}

/**
 * 在真正消费外部会话前执行完整的 owner、患者、audience 和 resource 复核。
 *
 * 患者范围采用“有患者必须精确相等、无患者也不能被补成患者会话”的严格
 * 规则；这样一个面向用户级客服的引用不会被误用为患者级资源，反过来也不
 * 会让患者报告分享引用脱离原患者范围。
 */
export function evaluateExternalEntrySession(
	value: unknown,
	context: ExternalEntrySessionConsumeContext,
): ExternalEntrySessionDecision {
	const session = normalizeExternalEntrySession(value);
	if (session.status === "revoked") {
		return { allowed: false, reason: "revoked" };
	}
	if (session.status === "consumed") {
		return { allowed: false, reason: "consumed" };
	}
	const expiresAt = parseInstant(session.expiresAt);
	if (expiresAt === undefined || expiresAt <= context.now.getTime()) {
		return { allowed: false, reason: "expired" };
	}
	if (session.ownerUserId !== context.ownerUserId) {
		return { allowed: false, reason: "owner-mismatch" };
	}
	if (session.patientId !== context.patientId) {
		return { allowed: false, reason: "patient-scope-mismatch" };
	}
	if (session.audience !== context.audience) {
		return { allowed: false, reason: "audience-mismatch" };
	}
	if (session.resourceKey !== context.resourceKey) {
		return { allowed: false, reason: "resource-mismatch" };
	}
	return { allowed: true, session };
}

/**
 * 一次性消费会话引用。
 *
 * 返回新对象而不修改输入，方便 persistence 层使用乐观锁/条件更新保证
 * 并发消费只有一个成功者；单纯调用这个函数不能替代数据库的 compare-and-set。
 */
export function consumeExternalEntrySession(
	value: unknown,
	context: ExternalEntrySessionConsumeContext,
): ExternalEntrySession {
	const decision = evaluateExternalEntrySession(value, context);
	if (!decision.allowed) {
		throw new ExternalEntrySessionConsumeError(decision.reason);
	}
	return {
		...decision.session,
		status: "consumed",
		consumedAt: context.now.toISOString(),
	};
}

/** 撤回只允许作用于尚未消费的会话；已消费引用是终态，不能伪装成可恢复。 */
export function revokeExternalEntrySession(
	value: unknown,
	now: Date,
): ExternalEntrySession {
	const session = normalizeExternalEntrySession(value);
	if (session.status === "consumed") {
		throw new ExternalEntrySessionConsumeError("consumed");
	}
	if (session.status === "revoked") return session;
	return {
		...session,
		status: "revoked",
		revokedAt: now.toISOString(),
	};
}
