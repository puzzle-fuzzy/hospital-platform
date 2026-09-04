import type {
	PaymentOrderPayload,
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
	PaymentPrepayAttemptVersionConflictError,
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

type PrepayErrorMetadata = {
	name?: unknown;
	requestOutcome?: unknown;
	failureStage?: unknown;
	requestId?: unknown;
};

function prepayErrorMetadata(error: unknown): PrepayErrorMetadata {
	if (typeof error !== "object" || error === null) return {};
	return error as PrepayErrorMetadata;
}

/**
 * 只有“请求尚未发出”或 provider 已明确拒绝时，才允许同一幂等键重试。
 * 网络超时、5xx、响应验签失败以及调起参数签名失败都可能发生在 provider
 * 已创建订单之后，必须保留 unknown 并走查单，不能因为用户再次点击就重建。
 */
function isKnownPrepayFailure(error: unknown): boolean {
	if (error instanceof Error && error.name === "AdapterNotConfiguredError") {
		return true;
	}
	const metadata = prepayErrorMetadata(error);
	return (
		metadata.requestOutcome === "not_sent" ||
		metadata.requestOutcome === "rejected"
	);
}

function providerRequestIdFromError(error: unknown): string | undefined {
	const metadata = prepayErrorMetadata(error);
	if (
		(metadata.failureStage !== "http" &&
			metadata.failureStage !== "response") ||
		typeof metadata.requestId !== "string" ||
		!metadata.requestId.trim()
	) {
		return undefined;
	}
	return metadata.requestId.trim();
}

/**
 * 预支付重试在真正调用 Provider 前还会经过身份仓储和尝试重置。
 * 这些边界失败不能只让 HTTP 层落一条 UNKNOWN；只记录异常类型和驱动
 * 已知短错误码，不记录 message、SQL、连接串或任何支付参数。
 */
function retryBoundaryErrorMetadata(error: unknown): {
	errorName: string;
	errorCode?: string;
} {
	const errorName = error instanceof Error ? error.name : "UnknownError";
	if (typeof error !== "object" || error === null) return { errorName };
	const code = (error as { code?: unknown }).code;
	return typeof code === "string" && /^[A-Za-z][A-Za-z0-9_.-]{0,63}$/.test(code)
		? { errorName, errorCode: code }
		: { errorName };
}

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
 * - 预支付尝试先落库；本地未发出/明确拒绝进入 failed 可重试，边界不确定进入 unknown 查单，绝不猜测 provider 结果；
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
		if (existing && existing.status !== "failed")
			return this.replayAttempt(existing, order.state, input.ownerUserId);

		// 已确认未发出/被拒绝的尝试可以复用同一业务幂等键重试；unknown
		// 则必须先由查单确认，不能走到这里重建。更新带 version 条件，
		// 并发点击时最多只有一个请求能把 failed 重新置为 pending。
		const storedIdentity = await this.dependencies.identityUsers.findByUserId(
			input.ownerUserId,
		);
		if (!storedIdentity) throw new PaymentIdentityNotFoundError();
		const identity = normalizeIdentityUserReadModel(storedIdentity, {
			expectedUserId: input.ownerUserId,
		});

		let pending: PaymentPrepayAttempt;
		if (existing) {
			this.logger.info(
				{
					event: "payment.wechat_prepay.retry_rearm_requested",
					ownerUserId: input.ownerUserId,
					orderId: order.orderId,
					attemptId: existing.attemptId,
					attemptVersion: existing.version,
				},
				"Wechat failed prepay attempt will be rearmed",
			);
			const retrying = this.rearmFailedAttempt(existing);
			try {
				pending = await this.dependencies.attempts.update(
					retrying,
					existing.version,
				);
			} catch (error) {
				if (!(error instanceof PaymentPrepayAttemptVersionConflictError))
					this.logger.error(
						{
							event: "payment.wechat_prepay.retry_rearm_failed",
							ownerUserId: input.ownerUserId,
							orderId: order.orderId,
							attemptId: existing.attemptId,
							attemptVersion: existing.version,
							...retryBoundaryErrorMetadata(error),
						},
						"Wechat failed prepay attempt could not be rearmed",
					);
				if (!(error instanceof PaymentPrepayAttemptVersionConflictError))
					throw error;
				const concurrent =
					await this.dependencies.attempts.findByOwnerOrderAndIdempotencyKey(
						input.ownerUserId,
						order.orderId,
						input.context.idempotencyKey,
					);
				if (!concurrent) throw new PaymentPrepayAttemptVersionConflictError();
				return this.replayAttempt(concurrent, order.state, input.ownerUserId);
			}
			this.logger.info(
				{
					event: "payment.wechat_prepay.retry_rearmed",
					ownerUserId: input.ownerUserId,
					orderId: order.orderId,
					attemptId: pending.attemptId,
					attemptVersion: pending.version,
				},
				"Wechat failed prepay attempt rearmed",
			);
		} else {
			const now = this.now();
			const timestamp = now.toISOString();
			pending = {
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
				return this.replayAttempt(stored, order.state, input.ownerUserId);
			}
		}

		return this.dispatchPrepay({
			input,
			order,
			identity,
			pending,
		});
	}

	private rearmFailedAttempt(
		attempt: PaymentPrepayAttempt,
	): PaymentPrepayAttempt {
		const {
			lastQueriedAt: _lastQueriedAt,
			nextQueryAt: _nextQueryAt,
			queryClaimedUntil: _queryClaimedUntil,
			manualReviewAt: _manualReviewAt,
			prepayId: _prepayId,
			payParams: _payParams,
			providerRequestId: _providerRequestId,
			lastErrorCode: _lastErrorCode,
			...base
		} = attempt;
		const timestamp = this.now().toISOString();
		return {
			...base,
			status: "pending",
			version: attempt.version + 1,
			queryAttempts: 0,
			nextQueryAt: new Date(
				this.now().getTime() + INITIAL_QUERY_DELAY_MS,
			).toISOString(),
			createdAt: attempt.createdAt,
			updatedAt: timestamp,
		};
	}

	private async dispatchPrepay(input: {
		input: WechatPrepayCreateInput;
		order: Awaited<ReturnType<PaymentOrderService["get"]>>;
		identity: ReturnType<typeof normalizeIdentityUserReadModel>;
		pending: PaymentPrepayAttempt;
	}): Promise<WechatPrepayPayload["data"]> {
		const { input: request, order, identity, pending } = input;

		this.logger.info(
			{
				event: "payment.wechat_prepay.requested",
				ownerUserId: request.ownerUserId,
				orderId: order.orderId,
				traceId: request.context.traceId,
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
				request.context,
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
					ownerUserId: request.ownerUserId,
					orderId: order.orderId,
					traceId: request.context.traceId,
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
			const knownFailure = isKnownPrepayFailure(error);
			const providerRequestId = providerRequestIdFromError(error);
			const failed: PaymentPrepayAttempt = {
				...pending,
				status: knownFailure ? "failed" : "unknown",
				version: pending.version + 1,
				lastErrorCode: error instanceof Error ? error.name : "UnknownError",
				updatedAt: this.now().toISOString(),
				...(providerRequestId ? { providerRequestId } : {}),
			};
			if (!knownFailure) failed.nextQueryAt = this.nextQueryAt();
			await this.dependencies.attempts
				.update(failed, pending.version)
				.catch(() => undefined);
			this.logger.warn(
				{
					event: "payment.wechat_prepay.failed",
					ownerUserId: request.ownerUserId,
					orderId: order.orderId,
					traceId: request.context.traceId,
					errorName: error instanceof Error ? error.name : "UnknownError",
					failureClass: knownFailure ? "known_failure" : "unknown",
					requestOutcome: prepayErrorMetadata(error).requestOutcome,
					failureStage: prepayErrorMetadata(error).failureStage,
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
					: attempt.status === "failed"
						? "failed"
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

	/**
	 * 直接向微信查单并把结果收敛到平台订单；小程序回调或 wx 调起成功
	 * 都不能替代这一步。普通自费挂号和通用门诊支付共用同一条状态边界。
	 */
	async reconcile(input: {
		ownerUserId: string;
		orderId: string;
		context: { traceId: string; idempotencyKey: string };
	}): Promise<{
		orderId: string;
		state: PaymentOrderPayload["data"]["state"];
		status: "pending" | "paid" | "failed";
	}> {
		const order = await this.dependencies.orders.get(
			input.ownerUserId,
			input.orderId,
		);
		if (order.state === "cash_paid" || order.state === "failed") {
			return {
				orderId: order.orderId,
				state: order.state,
				status: order.state === "cash_paid" ? "paid" : "failed",
			};
		}
		const result = await this.dependencies.wechatPayment.query(
			{ orderId: order.orderId },
			input.context,
		);
		const reconciled = await this.dependencies.orders.reconcileWechatPayment({
			orderId: order.orderId,
			state:
				result.state === "cash_paid"
					? "cash_paid"
					: result.state === "failed"
						? "failed"
						: "cash_pending",
			totalFen: result.totalFen,
			trace: result.trace,
		});
		const status =
			reconciled.order.state === "cash_paid"
				? "paid"
				: reconciled.order.state === "failed"
					? "failed"
					: "pending";
		return {
			orderId: reconciled.order.orderId,
			state: reconciled.order.state,
			status,
		};
	}

	private replayAttempt(
		attempt: PaymentPrepayAttempt,
		state: WechatPrepayPayload["data"]["state"],
		ownerUserId: string,
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
		if (attempt.status === "failed") {
			// create() 会先把已确认失败的尝试原子重置为 pending；如果
			// 未来新增入口遗漏了这一步，仍然不能把 failed 当成可支付参数。
			throw new PaymentPrepayAttemptUnknownError();
		}
		if (!attempt.payParams) {
			throw new PaymentPrepayAttemptUnknownError();
		}
		this.logger.info(
			{
				event: "payment.wechat_prepay.replayed",
				ownerUserId,
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
