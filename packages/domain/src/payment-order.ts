import type { PaymentState } from "@hospital/contracts";
import { transitionPayment } from "./payment-state";
import type { OutboxEvent } from "./outbox";
import type { ExternalTrace, WechatMiniProgramPayParams } from "./ports";

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

export type PaymentPrepayAttemptStatus = "pending" | "succeeded" | "unknown";

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
			!input.ownerUserId ||
			!input.patientId ||
			!input.idempotencyKey ||
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
			if (
				existing.patientId !== input.patientId ||
				existing.amounts.totalFen !== amounts.totalFen ||
				existing.amounts.insuranceFen !== amounts.insuranceFen ||
				existing.amounts.cashFen !== amounts.cashFen
			) {
				throw new PaymentIdempotencyConflictError();
			}
			return existing;
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
		return this.dependencies.orders.insert(
			order,
			createPaymentOrderEvent("payment-order.created", order),
		);
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
		const quote = await this.dependencies.quotes.findByOwnerAndId(
			input.ownerUserId,
			input.quoteId,
		);
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
		const order = await this.dependencies.orders.findByOwnerAndId(
			ownerUserId,
			orderId,
		);
		if (!order) throw new PaymentOrderNotFoundError();
		return order;
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
		const current = await this.dependencies.orders.findById(input.orderId);
		if (!current) throw new PaymentOrderNotFoundError();

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
			return {
				outcome,
				order: await this.dependencies.orders.update(
					updated,
					current.version,
					createPaymentOrderEvent(
						"payment-order.state-changed",
						updated,
						evidence,
					),
				),
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

	async transition(
		ownerUserId: string,
		orderId: string,
		nextState: PaymentState,
	): Promise<PaymentOrder> {
		const current = await this.dependencies.orders.findByOwnerAndId(
			ownerUserId,
			orderId,
		);
		if (!current) throw new PaymentOrderNotFoundError();

		const updated: PaymentOrder = {
			...current,
			state: transitionPayment(current.state, nextState),
			version: current.version + 1,
			updatedAt: this.now().toISOString(),
		};
		return this.dependencies.orders.update(
			updated,
			current.version,
			createPaymentOrderEvent("payment-order.state-changed", updated),
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
	evidence?: {
		provider: "wechat-pay";
		operation: string;
		requestId: string;
		providerOrderId?: string;
		reportedState: Extract<
			PaymentState,
			"cash_pending" | "cash_paid" | "failed"
		>;
		totalFen: number;
	},
): OutboxEvent {
	const suffix =
		eventName === "payment-order.created" ? "created" : order.version;
	return {
		eventId: `payment-order:${order.orderId}:${suffix}`,
		eventName,
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
