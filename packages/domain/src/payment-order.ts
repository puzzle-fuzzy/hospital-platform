import type { PaymentState } from "@hospital/contracts";
import { transitionPayment } from "./payment-state";
import { isBoundedOpaqueIdentifier } from "./opaque-identifier";
import type { OutboxEvent } from "./outbox";
import type {
	ExternalTrace,
	MedicalInsuranceSettlementEvidence,
	MedicalInsuranceSettlementEvidenceFinality,
	MedicalInsuranceSettlementEvidenceSource,
	MedicalInsuranceSettlementState,
	WechatMiniProgramPayParams,
} from "./ports";

/** 幂等键长度上限，防止客户端把无限长字符串写入订单索引。 */
const MAX_IDEMPOTENCY_KEY_LENGTH = 128;

/**
 * 金额统一使用人民币“分”的安全整数；禁止在领域层使用浮点元金额。
 * totalFen 必须等于 insuranceFen + cashFen，权威金额以后续 provider 证据覆盖。
 */
export type PaymentAmounts = {
	totalFen: number;
	insuranceFen: number;
	cashFen: number;
};

export class InvalidPaymentAmountsError extends Error {
	readonly reason: "not_safe_integer" | "negative" | "zero_total" | "mismatch";

	constructor(
		reason: "not_safe_integer" | "negative" | "zero_total" | "mismatch",
	) {
		super(`Invalid payment amounts: ${reason}`);
		this.name = "InvalidPaymentAmountsError";
		this.reason = reason;
	}
}

/** 在创建订单和接收 provider 金额时复用同一组不变量校验。 */
export function assertValidPaymentAmounts(
	amounts: PaymentAmounts,
): PaymentAmounts {
	const values = [amounts.totalFen, amounts.insuranceFen, amounts.cashFen];
	if (values.some((value) => !Number.isSafeInteger(value))) {
		throw new InvalidPaymentAmountsError("not_safe_integer");
	}
	if (values.some((value) => value < 0)) {
		throw new InvalidPaymentAmountsError("negative");
	}
	if (amounts.totalFen <= 0) {
		throw new InvalidPaymentAmountsError("zero_total");
	}
	const splitTotal = amounts.insuranceFen + amounts.cashFen;
	if (!Number.isSafeInteger(splitTotal) || splitTotal !== amounts.totalFen) {
		throw new InvalidPaymentAmountsError("mismatch");
	}
	return amounts;
}

/** 支付订单的内部事实模型；ownerUserId 永远来自服务端会话，不来自客户端请求。 */
export type PaymentOrder = {
	orderId: string;
	ownerUserId: string;
	patientId: string;
	idempotencyKey: string;
	amounts: PaymentAmounts;
	state: PaymentState;
	version: number;
	createdAt: string;
	updatedAt: string;
};

/** 服务端生成的费用报价；客户端只能引用 quoteId，不能提交金额拆分。 */
export type PaymentQuote = {
	quoteId: string;
	ownerUserId: string;
	patientId: string;
	amounts: PaymentAmounts;
	expiresAt: string;
	source: "hospital-his" | "fixture";
};

/** 支付订单的持久化状态白名单；未知状态不能继续驱动状态机或页面。 */
const PAYMENT_STATES: readonly PaymentState[] = [
	"created",
	"authorized",
	"pre_settled",
	"insurance_submitted",
	"insurance_settled",
	"cash_pending",
	"cash_paid",
	"his_written_back",
	"awaiting_confirmation",
	"completed",
	"failed",
	"cancelled",
];

/** MySQL 列宽比通用 opaque 标识更窄，读回时也必须复核实际列边界。 */
function isPaymentColumnIdentifier(value: unknown): value is string {
	return isBoundedOpaqueIdentifier(value) && value.length <= 64;
}

/** 允许 MySQL DATETIME(3) 和 UTC ISO 字符串，拒绝空值、控制字符和非法日期。 */
function isPaymentTimestamp(value: unknown): value is string {
	if (
		typeof value !== "string" ||
		value.length > 64 ||
		value !== value.trim() ||
		Array.from(value).some((character) => character.charCodeAt(0) <= 0x1f)
	) {
		return false;
	}
	const normalized = value.includes(" ") ? value.replace(" ", "T") : value;
	const withZone = /(?:Z|[+-]\d{2}:?\d{2})$/.test(normalized)
		? normalized
		: `${normalized}Z`;
	return Number.isFinite(Date.parse(withZone));
}

/** 支付订单仓储返回值违反内部 contract 时的固定原因。 */
export type PaymentOrderReadModelViolation =
	| "result-not-object"
	| "order-id-invalid"
	| "order-id-mismatch"
	| "owner-user-id-invalid"
	| "owner-user-id-mismatch"
	| "patient-id-invalid"
	| "patient-id-mismatch"
	| "idempotency-key-invalid"
	| "idempotency-key-mismatch"
	| "amounts-invalid"
	| "state-invalid"
	| "state-mismatch"
	| "version-invalid"
	| "version-mismatch"
	| "created-at-invalid"
	| "updated-at-invalid";

/** 订单读模型异常不能被当成“没有订单”，必须停止状态迁移。 */
export class PaymentOrderReadModelValidationError extends Error {
	readonly violation: PaymentOrderReadModelViolation;

	constructor(violation: PaymentOrderReadModelViolation) {
		super("Payment order read model is invalid");
		this.name = "PaymentOrderReadModelValidationError";
		this.violation = violation;
	}
}

/** 服务端报价读模型违反内部 contract 时，不能把错误金额带入订单。 */
export type PaymentQuoteReadModelViolation =
	| "result-not-object"
	| "quote-id-invalid"
	| "quote-id-mismatch"
	| "owner-user-id-invalid"
	| "owner-user-id-mismatch"
	| "patient-id-invalid"
	| "patient-id-mismatch"
	| "amounts-invalid"
	| "expires-at-invalid"
	| "source-invalid";

export class PaymentQuoteReadModelValidationError extends Error {
	readonly violation: PaymentQuoteReadModelViolation;

	constructor(violation: PaymentQuoteReadModelViolation) {
		super("Payment quote read model is invalid");
		this.name = "PaymentQuoteReadModelValidationError";
		this.violation = violation;
	}
}

function invalidPaymentOrderReadModel(
	violation: PaymentOrderReadModelViolation,
): never {
	throw new PaymentOrderReadModelValidationError(violation);
}

function invalidPaymentQuoteReadModel(
	violation: PaymentQuoteReadModelViolation,
): never {
	throw new PaymentQuoteReadModelValidationError(violation);
}

function paymentAmountsFromUnknown(value: unknown): PaymentAmounts {
	if (typeof value !== "object" || value === null || Array.isArray(value)) {
		invalidPaymentOrderReadModel("amounts-invalid");
	}
	const amounts = value as Record<string, unknown>;
	try {
		return assertValidPaymentAmounts({
			totalFen: amounts.totalFen as number,
			insuranceFen: amounts.insuranceFen as number,
			cashFen: amounts.cashFen as number,
		});
	} catch {
		invalidPaymentOrderReadModel("amounts-invalid");
	}
}

function paymentQuoteAmountsFromUnknown(value: unknown): PaymentAmounts {
	if (typeof value !== "object" || value === null || Array.isArray(value)) {
		invalidPaymentQuoteReadModel("amounts-invalid");
	}
	const amounts = value as Record<string, unknown>;
	try {
		return assertValidPaymentAmounts({
			totalFen: amounts.totalFen as number,
			insuranceFen: amounts.insuranceFen as number,
			cashFen: amounts.cashFen as number,
		});
	} catch {
		invalidPaymentQuoteReadModel("amounts-invalid");
	}
}

/**
 * 重新投影订单仓储结果。
 *
 * 仓储是运行时可替换端口，编译期的 `PaymentOrder` 不能证明 MySQL 行、
 * 回放数据或测试 fixture 真的满足 owner、金额、状态和版本不变量。所有
 * 进入状态机、outbox 或 API 的订单都必须经过这里；未知字段全部丢弃。
 */
export function normalizePaymentOrderReadModel(
	value: unknown,
	options: {
		expectedOrderId?: string;
		expectedOwnerUserId?: string;
		expectedPatientId?: string;
		expectedIdempotencyKey?: string;
		expectedState?: PaymentState;
		expectedVersion?: number;
	} = {},
): PaymentOrder {
	if (typeof value !== "object" || value === null || Array.isArray(value)) {
		invalidPaymentOrderReadModel("result-not-object");
	}
	const result = value as Record<string, unknown>;
	if (!isPaymentColumnIdentifier(result.orderId)) {
		invalidPaymentOrderReadModel("order-id-invalid");
	}
	if (
		options.expectedOrderId !== undefined &&
		result.orderId !== options.expectedOrderId
	) {
		invalidPaymentOrderReadModel("order-id-mismatch");
	}
	if (!isPaymentColumnIdentifier(result.ownerUserId)) {
		invalidPaymentOrderReadModel("owner-user-id-invalid");
	}
	if (
		options.expectedOwnerUserId !== undefined &&
		result.ownerUserId !== options.expectedOwnerUserId
	) {
		invalidPaymentOrderReadModel("owner-user-id-mismatch");
	}
	if (!isPaymentColumnIdentifier(result.patientId)) {
		invalidPaymentOrderReadModel("patient-id-invalid");
	}
	if (
		options.expectedPatientId !== undefined &&
		result.patientId !== options.expectedPatientId
	) {
		invalidPaymentOrderReadModel("patient-id-mismatch");
	}
	if (
		typeof result.idempotencyKey !== "string" ||
		!isBoundedOpaqueIdentifier(result.idempotencyKey) ||
		result.idempotencyKey.length > 128
	) {
		invalidPaymentOrderReadModel("idempotency-key-invalid");
	}
	if (
		options.expectedIdempotencyKey !== undefined &&
		result.idempotencyKey !== options.expectedIdempotencyKey
	) {
		invalidPaymentOrderReadModel("idempotency-key-mismatch");
	}
	const amounts = paymentAmountsFromUnknown(result.amounts);
	if (
		typeof result.state !== "string" ||
		!PAYMENT_STATES.includes(result.state as PaymentState)
	) {
		invalidPaymentOrderReadModel("state-invalid");
	}
	if (
		options.expectedState !== undefined &&
		result.state !== options.expectedState
	) {
		invalidPaymentOrderReadModel("state-mismatch");
	}
	if (
		typeof result.version !== "number" ||
		!Number.isSafeInteger(result.version) ||
		result.version < 1
	) {
		invalidPaymentOrderReadModel("version-invalid");
	}
	if (
		options.expectedVersion !== undefined &&
		result.version !== options.expectedVersion
	) {
		invalidPaymentOrderReadModel("version-mismatch");
	}
	if (!isPaymentTimestamp(result.createdAt)) {
		invalidPaymentOrderReadModel("created-at-invalid");
	}
	if (!isPaymentTimestamp(result.updatedAt)) {
		invalidPaymentOrderReadModel("updated-at-invalid");
	}
	return {
		orderId: result.orderId,
		ownerUserId: result.ownerUserId,
		patientId: result.patientId,
		idempotencyKey: result.idempotencyKey,
		amounts,
		state: result.state as PaymentState,
		version: result.version,
		createdAt: result.createdAt,
		updatedAt: result.updatedAt,
	};
}

/**
 * 重新投影报价仓储结果；报价是创建订单的唯一金额来源，不能只校验 quoteId。
 * 这里与订单读模型分开定义错误，便于日志判断是报价数据还是订单行损坏。
 */
export function normalizePaymentQuoteReadModel(
	value: unknown,
	options: {
		expectedQuoteId?: string;
		expectedOwnerUserId?: string;
		expectedPatientId?: string;
	} = {},
): PaymentQuote {
	if (typeof value !== "object" || value === null || Array.isArray(value)) {
		invalidPaymentQuoteReadModel("result-not-object");
	}
	const result = value as Record<string, unknown>;
	if (!isPaymentColumnIdentifier(result.quoteId)) {
		invalidPaymentQuoteReadModel("quote-id-invalid");
	}
	if (
		options.expectedQuoteId !== undefined &&
		result.quoteId !== options.expectedQuoteId
	) {
		invalidPaymentQuoteReadModel("quote-id-mismatch");
	}
	if (!isPaymentColumnIdentifier(result.ownerUserId)) {
		invalidPaymentQuoteReadModel("owner-user-id-invalid");
	}
	if (
		options.expectedOwnerUserId !== undefined &&
		result.ownerUserId !== options.expectedOwnerUserId
	) {
		invalidPaymentQuoteReadModel("owner-user-id-mismatch");
	}
	if (!isPaymentColumnIdentifier(result.patientId)) {
		invalidPaymentQuoteReadModel("patient-id-invalid");
	}
	if (
		options.expectedPatientId !== undefined &&
		result.patientId !== options.expectedPatientId
	) {
		invalidPaymentQuoteReadModel("patient-id-mismatch");
	}
	const amounts = paymentQuoteAmountsFromUnknown(result.amounts);
	if (!isPaymentTimestamp(result.expiresAt)) {
		invalidPaymentQuoteReadModel("expires-at-invalid");
	}
	if (result.source !== "hospital-his" && result.source !== "fixture") {
		invalidPaymentQuoteReadModel("source-invalid");
	}
	return {
		quoteId: result.quoteId,
		ownerUserId: result.ownerUserId,
		patientId: result.patientId,
		amounts,
		expiresAt: result.expiresAt,
		source: result.source,
	};
}

export type PaymentPrepayAttemptStatus =
	| "pending"
	| "succeeded"
	| "unknown"
	| "manual_review";

/**
 * 微信预支付尝试是独立的 provider 证据，不与订单状态混为一谈。
 * payParams 只允许进入受控的支付读模型，禁止进入日志、outbox payload 或领域事件。
 */
export type PaymentPrepayAttempt = {
	attemptId: string;
	ownerUserId: string;
	orderId: string;
	provider: "wechat-pay";
	idempotencyKey: string;
	status: PaymentPrepayAttemptStatus;
	version: number;
	/** provider 查单次数和时间都要持久化，worker 重启后不能退化成内存计数。 */
	queryAttempts: number;
	lastQueriedAt?: string;
	nextQueryAt?: string;
	/** 数据库 claim lease；进程崩溃后过期，其他 worker 才能接管查单。 */
	queryClaimedUntil?: string;
	/** 进入人工复核的时间；仅 manual_review 终态设置，便于后续运维审计。 */
	manualReviewAt?: string;
	prepayId?: string;
	payParams?: WechatMiniProgramPayParams;
	providerRequestId?: string;
	lastErrorCode?: string;
	createdAt: string;
	updatedAt: string;
};

/** 预支付尝试的持久化端口；生产实现必须以 owner/order/idempotency 建唯一键。 */
export interface PaymentPrepayAttemptRepository {
	findByOwnerOrderAndIdempotencyKey(
		ownerUserId: string,
		orderId: string,
		idempotencyKey: string,
	): Promise<PaymentPrepayAttempt | undefined>;
	insert(attempt: PaymentPrepayAttempt): Promise<PaymentPrepayAttempt>;
	update(
		attempt: PaymentPrepayAttempt,
		expectedVersion: number,
	): Promise<PaymentPrepayAttempt>;
	/** 原子领取已经到达 nextQueryAt 的记录；claim 本身递增 version，隔离过期 worker。 */
	claimDueForQuery(
		now: Date,
		limit: number,
		leaseMs: number,
	): Promise<readonly PaymentPrepayAttempt[]>;
}

/** 报价仓储负责提供已归属当前用户且尚未过期的后端金额。 */
export interface PaymentQuoteRepository {
	findByOwnerAndId(
		ownerUserId: string,
		quoteId: string,
	): Promise<PaymentQuote | undefined>;
}

/** 支付订单持久化端口；生产实现必须对 ownerUserId + idempotencyKey 建唯一约束。 */
export interface PaymentOrderRepository {
	/** 后台 worker 不持有用户会话，必须使用只读内部订单 id 查询。 */
	findById(orderId: string): Promise<PaymentOrder | undefined>;
	findByOwnerAndIdempotencyKey(
		ownerUserId: string,
		idempotencyKey: string,
	): Promise<PaymentOrder | undefined>;
	findByOwnerAndId(
		ownerUserId: string,
		orderId: string,
	): Promise<PaymentOrder | undefined>;
	/** 必须与 payment-order.created 在同一持久化事务中提交。 */
	insert(order: PaymentOrder, event: OutboxEvent): Promise<PaymentOrder>;
	/** 必须与 payment-order.state-changed 在同一持久化事务中提交。 */
	update(
		order: PaymentOrder,
		expectedVersion: number,
		event: OutboxEvent,
	): Promise<PaymentOrder>;
}

export class PaymentOrderInputError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "PaymentOrderInputError";
	}
}

export class PaymentIdempotencyConflictError extends Error {
	constructor() {
		super("Idempotency key was already used with a different payment order");
		this.name = "PaymentIdempotencyConflictError";
	}
}

export class PaymentOrderNotFoundError extends Error {
	constructor() {
		super("Payment order was not found");
		this.name = "PaymentOrderNotFoundError";
	}
}

export class PaymentQuoteNotFoundError extends Error {
	constructor() {
		super("Payment quote is not available");
		this.name = "PaymentQuoteNotFoundError";
	}
}

export class PaymentQuoteExpiredError extends Error {
	constructor() {
		super("Payment quote has expired");
		this.name = "PaymentQuoteExpiredError";
	}
}

export class PaymentOrderVersionConflictError extends Error {
	constructor() {
		super("Payment order was changed by another request");
		this.name = "PaymentOrderVersionConflictError";
	}
}

export class PaymentPrepayAttemptVersionConflictError extends Error {
	constructor() {
		super("Payment prepay attempt was changed by another request");
		this.name = "PaymentPrepayAttemptVersionConflictError";
	}
}

export class PaymentPrepayAttemptInProgressError extends Error {
	constructor() {
		super("Payment prepay attempt is still in progress");
		this.name = "PaymentPrepayAttemptInProgressError";
	}
}

export class PaymentPrepayAttemptUnknownError extends Error {
	constructor() {
		super("Payment prepay result requires provider confirmation");
		this.name = "PaymentPrepayAttemptUnknownError";
	}
}

/** 只有医保结算明确留下现金应付时，才允许申请微信预支付参数。 */
export class PaymentCashPrepayNotAllowedError extends Error {
	constructor() {
		super("Wechat cash prepay is not allowed for the current payment order");
		this.name = "PaymentCashPrepayNotAllowedError";
	}
}

export type WechatPaymentReconciliationOutcome =
	| "cash_paid"
	| "failed"
	| "awaiting_confirmation"
	| "unchanged"
	| "ignored";

export type WechatPaymentReconciliationResult = {
	outcome: WechatPaymentReconciliationOutcome;
	order: PaymentOrder;
};

export type MedicalInsuranceReconciliationOutcome =
	| "insurance_settled"
	| "cash_pending"
	| "failed"
	| "awaiting_confirmation"
	| "unchanged"
	| "ignored";

export type MedicalInsuranceReconciliationResult = {
	outcome: MedicalInsuranceReconciliationOutcome;
	order: PaymentOrder;
};

export type CreatePaymentOrderInput = {
	ownerUserId: string;
	patientId: string;
	idempotencyKey: string;
	amounts: PaymentAmounts;
};

export type PaymentOrderServiceDependencies = {
	orders: PaymentOrderRepository;
	quotes?: PaymentQuoteRepository;
	now?: () => Date;
	createOrderId?: () => string;
};

/**
 * 支付订单编排器只负责内部事实和状态迁移，不直接调用医保、微信支付或 HIS。
 * provider 调用由后续 worker 根据订单状态和 outbox 任务执行。
 */
export class PaymentOrderService {
	private readonly now: () => Date;
	private readonly createOrderId: () => string;

	constructor(private readonly dependencies: PaymentOrderServiceDependencies) {
		this.now = dependencies.now ?? (() => new Date());
		this.createOrderId =
			dependencies.createOrderId ??
			(() => crypto.randomUUID().replaceAll("-", ""));
	}

	async create(input: CreatePaymentOrderInput): Promise<PaymentOrder> {
		if (
			!isPaymentColumnIdentifier(input.ownerUserId) ||
			!isPaymentColumnIdentifier(input.patientId) ||
			!isBoundedOpaqueIdentifier(input.idempotencyKey) ||
			input.idempotencyKey.length > MAX_IDEMPOTENCY_KEY_LENGTH
		) {
			throw new PaymentOrderInputError(
				"ownerUserId, patientId and idempotencyKey are required",
			);
		}
		const amounts = assertValidPaymentAmounts(input.amounts);
		const existing =
			await this.dependencies.orders.findByOwnerAndIdempotencyKey(
				input.ownerUserId,
				input.idempotencyKey,
			);
		if (existing) {
			const stored = normalizePaymentOrderReadModel(existing, {
				expectedOwnerUserId: input.ownerUserId,
				expectedIdempotencyKey: input.idempotencyKey,
			});
			if (
				stored.patientId !== input.patientId ||
				stored.amounts.totalFen !== amounts.totalFen ||
				stored.amounts.insuranceFen !== amounts.insuranceFen ||
				stored.amounts.cashFen !== amounts.cashFen
			) {
				throw new PaymentIdempotencyConflictError();
			}
			return stored;
		}

		const timestamp = this.now().toISOString();
		const order: PaymentOrder = {
			orderId: this.createOrderId(),
			ownerUserId: input.ownerUserId,
			patientId: input.patientId,
			idempotencyKey: input.idempotencyKey,
			amounts,
			state: "created",
			version: 1,
			createdAt: timestamp,
			updatedAt: timestamp,
		};
		// 在写入和 outbox 事务之前先验证服务端新建的订单，覆盖自定义 ID 生成器
		// 或未来组合根注入错误值的情况；不能等落库后才发现订单形状非法。
		const candidate = normalizePaymentOrderReadModel(order, {
			expectedOwnerUserId: input.ownerUserId,
			expectedPatientId: input.patientId,
			expectedIdempotencyKey: input.idempotencyKey,
		});
		const stored = await this.dependencies.orders.insert(
			candidate,
			createPaymentOrderEvent("payment-order.created", candidate),
		);
		const normalized = normalizePaymentOrderReadModel(stored, {
			expectedOwnerUserId: candidate.ownerUserId,
			expectedIdempotencyKey: candidate.idempotencyKey,
		});
		if (
			normalized.patientId !== candidate.patientId ||
			normalized.amounts.totalFen !== candidate.amounts.totalFen ||
			normalized.amounts.insuranceFen !== candidate.amounts.insuranceFen ||
			normalized.amounts.cashFen !== candidate.amounts.cashFen
		) {
			// 仓储可能在唯一键竞争后返回已存在订单；只有同一业务身份才能安全重放。
			throw new PaymentIdempotencyConflictError();
		}
		return normalized;
	}

	/** 通过服务端 quote 创建订单，防止客户端伪造医保和现金金额。 */
	async createFromQuote(input: {
		ownerUserId: string;
		patientId: string;
		quoteId: string;
		idempotencyKey: string;
	}): Promise<PaymentOrder> {
		if (!this.dependencies.quotes) {
			throw new PaymentOrderInputError("Payment quote repository is required");
		}
		const quoteResult = await this.dependencies.quotes.findByOwnerAndId(
			input.ownerUserId,
			input.quoteId,
		);
		const quote = quoteResult
			? normalizePaymentQuoteReadModel(quoteResult, {
					expectedOwnerUserId: input.ownerUserId,
					expectedQuoteId: input.quoteId,
				})
			: undefined;
		if (!quote || quote.patientId !== input.patientId) {
			throw new PaymentQuoteNotFoundError();
		}
		const expiresAt = new Date(quote.expiresAt).getTime();
		if (!Number.isFinite(expiresAt) || expiresAt <= this.now().getTime()) {
			throw new PaymentQuoteExpiredError();
		}

		return this.create({
			ownerUserId: input.ownerUserId,
			patientId: input.patientId,
			idempotencyKey: input.idempotencyKey,
			amounts: assertValidPaymentAmounts(quote.amounts),
		});
	}

	async get(ownerUserId: string, orderId: string): Promise<PaymentOrder> {
		const result = await this.dependencies.orders.findByOwnerAndId(
			ownerUserId,
			orderId,
		);
		if (!result) throw new PaymentOrderNotFoundError();
		return normalizePaymentOrderReadModel(result, {
			expectedOwnerUserId: ownerUserId,
			expectedOrderId: orderId,
		});
	}

	/**
	 * 将已验签的微信查单结果应用到订单。
	 *
	 * 只有明确的 provider 状态、匹配的现金金额和合法的内部状态边才允许
	 * 迁移；金额不一致进入 awaiting_confirmation，绝不自动判定支付成功。
	 */
	async reconcileWechatPayment(input: {
		orderId: string;
		state: Extract<PaymentState, "cash_pending" | "cash_paid" | "failed">;
		totalFen: number;
		trace: ExternalTrace;
	}): Promise<WechatPaymentReconciliationResult> {
		const result = await this.dependencies.orders.findById(input.orderId);
		if (!result) throw new PaymentOrderNotFoundError();
		const current = normalizePaymentOrderReadModel(result, {
			expectedOrderId: input.orderId,
		});

		const evidence = {
			provider: "wechat-pay" as const,
			operation: input.trace.operation,
			requestId: input.trace.requestId,
			...(input.trace.providerOrderId
				? { providerOrderId: input.trace.providerOrderId }
				: {}),
			reportedState: input.state,
			totalFen: input.totalFen,
		};

		const update = async (
			nextState: PaymentState,
			outcome: WechatPaymentReconciliationOutcome,
		): Promise<WechatPaymentReconciliationResult> => {
			const updated: PaymentOrder = {
				...current,
				state: transitionPayment(current.state, nextState),
				version: current.version + 1,
				updatedAt: this.now().toISOString(),
			};
			const stored = await this.dependencies.orders.update(
				updated,
				current.version,
				createPaymentOrderEvent(
					"payment-order.state-changed",
					updated,
					evidence,
				),
			);
			return {
				outcome,
				order: normalizePaymentOrderReadModel(stored, {
					expectedOrderId: updated.orderId,
					expectedOwnerUserId: updated.ownerUserId,
					expectedState: updated.state,
					expectedVersion: updated.version,
				}),
			};
		};

		if (input.totalFen !== current.amounts.cashFen) {
			if (current.state === "cash_pending") {
				return update("awaiting_confirmation", "awaiting_confirmation");
			}
			return { outcome: "ignored", order: current };
		}

		if (input.state === "cash_paid") {
			if (
				current.state === "cash_pending" ||
				current.state === "awaiting_confirmation"
			) {
				return update("cash_paid", "cash_paid");
			}
			return { outcome: "ignored", order: current };
		}

		if (input.state === "failed") {
			if (
				current.state === "cash_pending" ||
				current.state === "awaiting_confirmation"
			) {
				return update("failed", "failed");
			}
			return { outcome: "ignored", order: current };
		}

		return { outcome: "unchanged", order: current };
	}

	/**
	 * 将医保 6202/6301/6302/HIS 证据应用到订单。
	 *
	 * 6202/6301 的外层 success、HTTP 200 或 ordStas=1～6 都不足以把订单
	 * 标为最终成功。只有带有权威来源和 paid finality 的证据才允许推进；
	 * 推进后最多到 insurance_settled/cash_pending，永远不能越过现金支付和
	 * HIS 回写直接进入 completed。
	 */
	async reconcileMedicalInsuranceSettlement(
		input: MedicalInsuranceSettlementEvidence & { orderId: string },
	): Promise<MedicalInsuranceReconciliationResult> {
		const result = await this.dependencies.orders.findById(input.orderId);
		if (!result) throw new PaymentOrderNotFoundError();
		const current = normalizePaymentOrderReadModel(result, {
			expectedOrderId: input.orderId,
		});
		assertMedicalInsuranceEvidence(input);

		const evidence = {
			provider: input.trace.provider,
			operation: input.trace.operation,
			requestId: input.trace.requestId,
			...(input.trace.providerOrderId
				? { providerOrderId: input.trace.providerOrderId }
				: {}),
			source: input.source,
			providerStatus: input.providerStatus,
			finality: input.finality,
			authoritative: input.authoritative,
			state: input.state,
			amounts: input.amounts,
		};

		const update = async (
			nextState: PaymentState,
			outcome: MedicalInsuranceReconciliationOutcome,
		): Promise<MedicalInsuranceReconciliationResult> => {
			const updated: PaymentOrder = {
				...current,
				state: transitionPayment(current.state, nextState),
				version: current.version + 1,
				updatedAt: this.now().toISOString(),
			};
			const stored = await this.dependencies.orders.update(
				updated,
				current.version,
				createPaymentOrderEvent(
					"payment-order.state-changed",
					updated,
					evidence,
				),
			);
			return {
				outcome,
				order: normalizePaymentOrderReadModel(stored, {
					expectedOrderId: updated.orderId,
					expectedOwnerUserId: updated.ownerUserId,
					expectedState: updated.state,
					expectedVersion: updated.version,
				}),
			};
		};
		const waitForConfirmation =
			async (): Promise<MedicalInsuranceReconciliationResult> => {
				if (current.state === "awaiting_confirmation") {
					return { outcome: "awaiting_confirmation", order: current };
				}
				return update("awaiting_confirmation", "awaiting_confirmation");
			};

		if (!samePaymentAmounts(input.amounts, current.amounts)) {
			if (
				current.state === "insurance_submitted" ||
				current.state === "awaiting_confirmation"
			) {
				return waitForConfirmation();
			}
			return { outcome: "ignored", order: current };
		}

		if (input.finality === "failed" || input.finality === "cancelled") {
			if (
				input.authoritative &&
				(current.state === "insurance_submitted" ||
					current.state === "awaiting_confirmation")
			) {
				return update("failed", "failed");
			}
			if (
				current.state === "insurance_submitted" ||
				current.state === "awaiting_confirmation"
			) {
				return waitForConfirmation();
			}
			return { outcome: "ignored", order: current };
		}

		// 6202/6301 的“处理中”或“后置候选”都只能留下待确认事实；
		// 不能因为返回了完整金额就把它当成保险已结算。
		if (input.finality !== "paid" || !input.authoritative) {
			if (
				current.state === "insurance_submitted" ||
				current.state === "awaiting_confirmation"
			) {
				return waitForConfirmation();
			}
			return { outcome: "unchanged", order: current };
		}

		const expectedState: Extract<
			PaymentState,
			"insurance_settled" | "cash_pending"
		> = input.amounts.cashFen > 0 ? "cash_pending" : "insurance_settled";
		if (input.state !== expectedState) {
			if (
				current.state === "insurance_submitted" ||
				current.state === "awaiting_confirmation"
			) {
				return waitForConfirmation();
			}
			return { outcome: "ignored", order: current };
		}

		if (
			current.state === "insurance_submitted" ||
			current.state === "awaiting_confirmation"
		) {
			return update(expectedState, expectedState);
		}
		return { outcome: "ignored", order: current };
	}

	async transition(
		ownerUserId: string,
		orderId: string,
		nextState: PaymentState,
	): Promise<PaymentOrder> {
		const result = await this.dependencies.orders.findByOwnerAndId(
			ownerUserId,
			orderId,
		);
		if (!result) throw new PaymentOrderNotFoundError();
		const current = normalizePaymentOrderReadModel(result, {
			expectedOwnerUserId: ownerUserId,
			expectedOrderId: orderId,
		});

		const updated: PaymentOrder = {
			...current,
			state: transitionPayment(current.state, nextState),
			version: current.version + 1,
			updatedAt: this.now().toISOString(),
		};
		const stored = await this.dependencies.orders.update(
			updated,
			current.version,
			createPaymentOrderEvent("payment-order.state-changed", updated),
		);
		return normalizePaymentOrderReadModel(stored, {
			expectedOrderId: updated.orderId,
			expectedOwnerUserId: updated.ownerUserId,
			expectedState: updated.state,
			expectedVersion: updated.version,
		});
	}
}

function samePaymentAmounts(
	left: PaymentAmounts,
	right: PaymentAmounts,
): boolean {
	return (
		left.totalFen === right.totalFen &&
		left.insuranceFen === right.insuranceFen &&
		left.cashFen === right.cashFen
	);
}

function assertMedicalInsuranceEvidence(
	input: MedicalInsuranceSettlementEvidence & { orderId: string },
): void {
	try {
		assertValidPaymentAmounts(input.amounts);
	} catch {
		throw new PaymentOrderInputError("Medical insurance amounts are invalid");
	}
	if (
		typeof input.providerStatus !== "string" ||
		input.providerStatus.length === 0 ||
		input.providerStatus.length > 32 ||
		!/^[A-Za-z0-9_.:=\-]+$/.test(input.providerStatus)
	) {
		throw new PaymentOrderInputError(
			"Medical insurance provider status is invalid",
		);
	}
	if (typeof input.authoritative !== "boolean") {
		throw new PaymentOrderInputError(
			"Medical insurance evidence authority is invalid",
		);
	}
	const sources: readonly MedicalInsuranceSettlementEvidenceSource[] = [
		"6202",
		"6301",
		"6302",
		"yunhealth",
	];
	const finalities: readonly MedicalInsuranceSettlementEvidenceFinality[] = [
		"processing",
		"settlement_candidate",
		"paid",
		"cancelled",
		"failed",
		"unknown",
	];
	const states: readonly MedicalInsuranceSettlementState[] = [
		"insurance_settled",
		"cash_pending",
		"awaiting_confirmation",
		"failed",
	];
	if (
		!sources.includes(input.source) ||
		!finalities.includes(input.finality) ||
		!states.includes(input.state)
	) {
		throw new PaymentOrderInputError(
			"Medical insurance evidence classification is invalid",
		);
	}
	if (input.finality === "paid" && input.source !== "yunhealth") {
		throw new PaymentOrderInputError(
			"Medical insurance paid evidence must come from Yunhealth/HIS",
		);
	}
}

/**
 * 订单事件只携带 worker 恢复所需的内部摘要，不携带凭证、原始 provider 报文或患者敏感信息。
 * eventId 按订单和版本确定，数据库重试时不会重复制造逻辑事件。
 */
function createPaymentOrderEvent(
	eventName: "payment-order.created" | "payment-order.state-changed",
	order: PaymentOrder,
	evidence?:
		| {
				provider: "wechat-pay";
				operation: string;
				requestId: string;
				providerOrderId?: string;
				reportedState: Extract<
					PaymentState,
					"cash_pending" | "cash_paid" | "failed"
				>;
				totalFen: number;
		  }
		| {
				provider: string;
				operation: string;
				requestId: string;
				providerOrderId?: string;
				source: MedicalInsuranceSettlementEvidenceSource;
				providerStatus: string;
				finality: MedicalInsuranceSettlementEvidenceFinality;
				authoritative: boolean;
				state: MedicalInsuranceSettlementState;
				amounts: PaymentAmounts;
		  },
): OutboxEvent {
	const suffix =
		eventName === "payment-order.created" ? "created" : order.version;
	return {
		eventId: `payment-order:${order.orderId}:${suffix}`,
		eventName,
		status: "pending",
		aggregateId: order.orderId,
		payload: {
			orderId: order.orderId,
			patientId: order.patientId,
			amounts: order.amounts,
			state: order.state,
			version: order.version,
			...(evidence ? { providerEvidence: evidence } : {}),
		},
		occurredAt: order.updatedAt,
		availableAt: order.updatedAt,
		attempts: 0,
	};
}
