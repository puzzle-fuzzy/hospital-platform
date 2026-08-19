import type {
	WechatPrepayPayload,
	WechatPrepayStatusPayload,
} from "@hospital/contracts";
import {
	DependencyNotConfiguredError,
	isBoundedOpaqueIdentifier,
	normalizeIdentityUserReadModel,
	PaymentCashPrepayNotAllowedError,
	PaymentOrderInputError,
	type PaymentOrderService,
	type PaymentPrepayAttempt,
	PaymentPrepayAttemptInProgressError,
	type PaymentPrepayAttemptRepository,
	PaymentPrepayAttemptUnknownError,
	type UserIdentityRepository,
	type WechatPaymentGateway,
} from "@hospital/domain";
import { type AppLogger, createNoopLogger } from "@hospital/observability";

/** API 请求崩溃后给 worker 留出的最小恢复窗口，避免和前一个请求并发查单。 */
const INITIAL_QUERY_DELAY_MS = 5_000;
/** provider 结果未确定时的下一次查单间隔；后续可按 provider SLA 配置化。 */
const DEFAULT_QUERY_DELAY_MS = 15_000;

export class PaymentIdentityNotFoundError extends Error {
	constructor() {
		super("Payment identity was not found for the current user");
		this.name = "PaymentIdentityNotFoundError";
	}
}

export type WechatPrepayServiceDependencies = {
	orders: PaymentOrderService;
	identityUsers: UserIdentityRepository;
	attempts: PaymentPrepayAttemptRepository;
	wechatPayment: WechatPaymentGateway;
	logger?: AppLogger;
	now?: () => Date;
	createAttemptId?: () => string;
};

type WechatPrepayCreateInput = {
	ownerUserId: string;
	orderId: string;
	context: { traceId: string; idempotencyKey: string };
};

type WechatPrepayReadInput = {
	ownerUserId: string;
	orderId: string;
	idempotencyKey: string;
};

/**
 * 预支付服务也可能被组合根或 Worker 直接调用，不能只依赖 HTTP schema。
 *
 * 这里仅验证平台内部标识和链路字段的形状，不代表订单允许支付，也不
 * 代表真实微信/医保 contract 已打开；订单状态、金额和 provider gate 仍
 * 在后续业务步骤继续校验。先收敛运行时对象，可以避免 null/数组在读取
 * 属性时变成未映射 500，更不能让异常输入触碰订单仓储或支付 Provider。
 */
function normalizeWechatPrepayCreateInput(
	value: unknown,
): WechatPrepayCreateInput {
	if (typeof value !== "object" || value === null || Array.isArray(value)) {
		throw new PaymentOrderInputError("Wechat prepay input is invalid");
	}
	const record = value as Record<string, unknown>;
	const context = record.context;
	if (
		!isBoundedOpaqueIdentifier(record.ownerUserId) ||
		!isBoundedOpaqueIdentifier(record.orderId) ||
		typeof context !== "object" ||
		context === null ||
		Array.isArray(context)
	) {
		throw new PaymentOrderInputError("Wechat prepay input is invalid");
	}
	const contextRecord = context as Record<string, unknown>;
	if (
		!isBoundedOpaqueIdentifier(contextRecord.traceId) ||
		!isBoundedOpaqueIdentifier(contextRecord.idempotencyKey)
	) {
		throw new PaymentOrderInputError("Wechat prepay context is invalid");
	}
	return {
		ownerUserId: record.ownerUserId,
		orderId: record.orderId,
		context: {
			traceId: contextRecord.traceId,
			idempotencyKey: contextRecord.idempotencyKey,
		},
	};
}

/** 读取预支付状态使用同一组 owner/order/幂等键边界，不能绕过创建端校验。 */
function normalizeWechatPrepayReadInput(value: unknown): WechatPrepayReadInput {
	if (typeof value !== "object" || value === null || Array.isArray(value)) {
		throw new PaymentOrderInputError("Wechat prepay read input is invalid");
	}
	const record = value as Record<string, unknown>;
	if (
		!isBoundedOpaqueIdentifier(record.ownerUserId) ||
		!isBoundedOpaqueIdentifier(record.orderId) ||
		!isBoundedOpaqueIdentifier(record.idempotencyKey)
	) {
		throw new PaymentOrderInputError("Wechat prepay read input is invalid");
	}
	return {
		ownerUserId: record.ownerUserId,
		orderId: record.orderId,
		idempotencyKey: record.idempotencyKey,
	};
}

/**
 * 微信预支付应用服务是一个很窄的 provider 边界：
 *
 * - openid 只从服务端身份仓储读取，不接受客户端提交；
 * - 只允许对医保结算后明确留下的 cash_pending 订单申请现金预支付；
 * - 返回 payParams 只是“可调起支付”，不迁移订单到 cash_paid 或 completed；
 * - 预支付尝试先落库，重试会复用已成功的参数或明确进入待确认，不重复猜测 provider 结果；
 * - 日志只记录内部订单、trace 和 provider request id，不记录 openid、prepay_id 或签名。
 */
export class WechatPrepayService {
	private readonly logger: AppLogger;
	private readonly now: () => Date;
	private readonly createAttemptId: () => string;

	constructor(private readonly dependencies: WechatPrepayServiceDependencies) {
		this.logger = dependencies.logger ?? createNoopLogger();
		this.now = dependencies.now ?? (() => new Date());
		this.createAttemptId =
			dependencies.createAttemptId ??
			(() => crypto.randomUUID().replaceAll("-", ""));
	}

	private nextQueryAt(delayMs = DEFAULT_QUERY_DELAY_MS): string {
		return new Date(this.now().getTime() + delayMs).toISOString();
	}

	async create(
		input: WechatPrepayCreateInput,
	): Promise<WechatPrepayPayload["data"]> {
		input = normalizeWechatPrepayCreateInput(input);
		const order = await this.dependencies.orders.get(
			input.ownerUserId,
			input.orderId,
		);
		if (order.state !== "cash_pending" || order.amounts.cashFen <= 0) {
			throw new PaymentCashPrepayNotAllowedError();
		}

		const existing =
			await this.dependencies.attempts.findByOwnerOrderAndIdempotencyKey(
				input.ownerUserId,
				order.orderId,
				input.context.idempotencyKey,
			);
		if (existing) return this.replayAttempt(existing, order.state);

		const storedIdentity = await this.dependencies.identityUsers.findByUserId(
			input.ownerUserId,
		);
		if (!storedIdentity) throw new PaymentIdentityNotFoundError();
		const identity = normalizeIdentityUserReadModel(storedIdentity, {
			expectedUserId: input.ownerUserId,
		});
		const now = this.now();
		const timestamp = now.toISOString();
		const pending: PaymentPrepayAttempt = {
			attemptId: this.createAttemptId(),
			ownerUserId: input.ownerUserId,
			orderId: order.orderId,
			provider: "wechat-pay",
			idempotencyKey: input.context.idempotencyKey,
			status: "pending",
			version: 1,
			queryAttempts: 0,
			nextQueryAt: new Date(
				now.getTime() + INITIAL_QUERY_DELAY_MS,
			).toISOString(),
			createdAt: timestamp,
			updatedAt: timestamp,
		};
		const stored = await this.dependencies.attempts.insert(pending);
		if (stored.attemptId !== pending.attemptId) {
			return this.replayAttempt(stored, order.state);
		}

		this.logger.info(
			{
				event: "payment.wechat_prepay.requested",
				orderId: order.orderId,
				traceId: input.context.traceId,
				cashFen: order.amounts.cashFen,
			},
			"Wechat prepay requested",
		);

		try {
			const result = await this.dependencies.wechatPayment.createJsapiOrder(
				{
					orderId: order.orderId,
					openid: identity.providerSubject,
					totalFen: order.amounts.cashFen,
				},
				input.context,
			);
			const succeeded: PaymentPrepayAttempt = {
				...pending,
				status: "succeeded",
				version: pending.version + 1,
				prepayId: result.prepayId,
				payParams: result.payParams,
				providerRequestId: result.trace.requestId,
				nextQueryAt: this.nextQueryAt(),
				updatedAt: this.now().toISOString(),
			};
			await this.dependencies.attempts.update(succeeded, pending.version);
			this.logger.info(
				{
					event: "payment.wechat_prepay.created",
					orderId: order.orderId,
					traceId: input.context.traceId,
					provider: result.trace.provider,
					operation: result.trace.operation,
					providerRequestId: result.trace.requestId,
				},
				"Wechat prepay parameters created",
			);
			return {
				orderId: order.orderId,
				state: order.state,
				payParams: result.payParams,
			};
		} catch (error) {
			// 配置闸门未打开时也必须把 pending 收敛为 unknown。
			// 如果把这类失败留在 pending，同一幂等键后续会永久得到“处理中”，
			// 既掩盖真实配置问题，也会让补齐配置后的重试无法进入明确的恢复路径。
			const unknown: PaymentPrepayAttempt = {
				...pending,
				status: "unknown",
				version: pending.version + 1,
				lastErrorCode: error instanceof Error ? error.name : "UnknownError",
				nextQueryAt: this.nextQueryAt(),
				updatedAt: this.now().toISOString(),
			};
			await this.dependencies.attempts
				.update(unknown, pending.version)
				.catch(() => undefined);
			this.logger.warn(
				{
					event: "payment.wechat_prepay.failed",
					orderId: order.orderId,
					traceId: input.context.traceId,
					errorName: error instanceof Error ? error.name : "UnknownError",
				},
				"Wechat prepay request failed",
			);
			throw error;
		}
	}

	/** 只读取当前用户的尝试事实；查询不会调用微信或改变订单状态。 */
	async read(
		input: WechatPrepayReadInput,
	): Promise<WechatPrepayStatusPayload["data"]> {
		input = normalizeWechatPrepayReadInput(input);
		const order = await this.dependencies.orders.get(
			input.ownerUserId,
			input.orderId,
		);
		const attempt =
			await this.dependencies.attempts.findByOwnerOrderAndIdempotencyKey(
				input.ownerUserId,
				input.orderId,
				input.idempotencyKey,
			);
		if (!attempt) {
			return {
				orderId: order.orderId,
				state: order.state,
				status: "not_started",
			};
		}

		const status: WechatPrepayStatusPayload["data"]["status"] =
			attempt.status === "pending"
				? "pending"
				: attempt.status === "unknown"
					? "unknown"
					: attempt.payParams
						? "ready"
						: "unknown";
		this.logger.debug(
			{
				event: "payment.wechat_prepay.read",
				orderId: order.orderId,
				attemptId: attempt.attemptId,
				status,
			},
			"Wechat prepay status read",
		);
		return {
			orderId: order.orderId,
			state: order.state,
			status,
			...(status === "ready" && attempt.payParams
				? { payParams: attempt.payParams }
				: {}),
		};
	}

	private replayAttempt(
		attempt: PaymentPrepayAttempt,
		state: WechatPrepayPayload["data"]["state"],
	): WechatPrepayPayload["data"] {
		if (attempt.status === "pending") {
			throw new PaymentPrepayAttemptInProgressError();
		}
		if (attempt.status === "unknown") {
			if (attempt.lastErrorCode === "AdapterNotConfiguredError") {
				throw new DependencyNotConfiguredError("wechat-pay");
			}
			throw new PaymentPrepayAttemptUnknownError();
		}
		if (!attempt.payParams) {
			throw new PaymentPrepayAttemptUnknownError();
		}
		this.logger.info(
			{
				event: "payment.wechat_prepay.replayed",
				orderId: attempt.orderId,
				attemptId: attempt.attemptId,
			},
			"Wechat prepay parameters replayed",
		);
		return {
			orderId: attempt.orderId,
			state,
			payParams: attempt.payParams,
		};
	}
}
