import type { PaymentState } from "@hospital/contracts";
import { transitionPayment } from "./payment-state";

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

/** 支付订单持久化端口；生产实现必须对 ownerUserId + idempotencyKey 建唯一约束。 */
export interface PaymentOrderRepository {
	findByOwnerAndIdempotencyKey(
		ownerUserId: string,
		idempotencyKey: string,
	): Promise<PaymentOrder | undefined>;
	findByOwnerAndId(
		ownerUserId: string,
		orderId: string,
	): Promise<PaymentOrder | undefined>;
	insert(order: PaymentOrder): Promise<PaymentOrder>;
	update(order: PaymentOrder, expectedVersion: number): Promise<PaymentOrder>;
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

export class PaymentOrderVersionConflictError extends Error {
	constructor() {
		super("Payment order was changed by another request");
		this.name = "PaymentOrderVersionConflictError";
	}
}

export type CreatePaymentOrderInput = {
	ownerUserId: string;
	patientId: string;
	idempotencyKey: string;
	amounts: PaymentAmounts;
};

export type PaymentOrderServiceDependencies = {
	orders: PaymentOrderRepository;
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
			dependencies.createOrderId ?? (() => crypto.randomUUID());
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
		return this.dependencies.orders.insert({
			orderId: this.createOrderId(),
			ownerUserId: input.ownerUserId,
			patientId: input.patientId,
			idempotencyKey: input.idempotencyKey,
			amounts,
			state: "created",
			version: 1,
			createdAt: timestamp,
			updatedAt: timestamp,
		});
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
		return this.dependencies.orders.update(updated, current.version);
	}
}
