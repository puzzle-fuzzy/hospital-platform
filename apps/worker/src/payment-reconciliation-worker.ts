import type {
	HospitalSettlementGateway,
	PaymentOrder,
	PaymentOrderService,
	PaymentPrepayAttempt,
	PaymentPrepayAttemptRepository,
	RegistrationSelfPaySettlementContext,
	WechatPaymentGateway,
} from "@hospital/domain";
import {
	type AppLogger,
	createNoopLogger,
	providerFailureMetadata,
} from "@hospital/observability";

/** 首次明确未支付后给 provider 的最小重试间隔。 */
const BASE_QUERY_DELAY_MS = 15_000;
/** provider 故障时的查单退避上限，避免 worker 形成高频风暴。 */
const MAX_QUERY_DELAY_MS = 15 * 60 * 1000;
/** 每次 worker tick 只领取一条，保证数据库版本和 provider 请求边界清晰。 */
const QUERY_BATCH_SIZE = 1;
/** provider 查询异常或进程崩溃后的 claim 接管窗口。 */
const QUERY_CLAIM_LEASE_MS = 60_000;

const REGISTRATION_SELF_PAY_ORDER_PREFIX = "registration-self-pay:";
/**
 * 微信查单自动重试上限；达到上限后必须停在 manual_review，等待人工核对，
 * 不能继续制造没有边界的 provider 请求。
 */
export const MAX_PAYMENT_QUERY_ATTEMPTS = 12;

export type PaymentReconciliationWorkerResult =
	| "idle"
	| "reconciled"
	/** Provider 已明确确认没有订单，本地尝试可安全重新发起。 */
	| "failed"
	| "retry_scheduled"
	| "manual_review";

function queryDelayMs(queryAttempts: number): number {
	return Math.min(
		MAX_QUERY_DELAY_MS,
		BASE_QUERY_DELAY_MS * 2 ** Math.max(0, queryAttempts),
	);
}

function updateAttemptSchedule(
	attempt: PaymentPrepayAttempt,
	now: Date,
	options: {
		shouldContinue: boolean;
		status?: PaymentPrepayAttempt["status"];
		lastErrorCode?: string;
	},
): PaymentPrepayAttempt {
	// exactOptionalPropertyTypes 下不能把 undefined 写回可选字段；删除旧计划
	// 后只在确实需要继续查单时重新加入 nextQueryAt。
	const {
		nextQueryAt: _previousNextQueryAt,
		queryClaimedUntil: _previousQueryClaimedUntil,
		lastErrorCode: _previousLastErrorCode,
		manualReviewAt: _previousManualReviewAt,
		...withoutQuerySchedule
	} = attempt;
	const queryAttempts = Math.min(
		Number.MAX_SAFE_INTEGER,
		attempt.queryAttempts + 1,
	);
	const exhausted =
		options.shouldContinue && queryAttempts >= MAX_PAYMENT_QUERY_ATTEMPTS;
	return {
		...withoutQuerySchedule,
		status: options.status ?? (exhausted ? "manual_review" : attempt.status),
		queryAttempts,
		lastQueriedAt: now.toISOString(),
		version: attempt.version + 1,
		updatedAt: now.toISOString(),
		...(options.lastErrorCode ? { lastErrorCode: options.lastErrorCode } : {}),
		...(exhausted ? { manualReviewAt: now.toISOString() } : {}),
		...(options.shouldContinue && !exhausted
			? {
					nextQueryAt: new Date(
						now.getTime() + queryDelayMs(attempt.queryAttempts),
					).toISOString(),
				}
			: {}),
	};
}

/**
 * 查单补偿 worker。
 *
 * 它只领取持久化的 nextQueryAt，不维护进程内队列；每次 provider 查询后
 * 先用订单版本和金额校验应用结果，再版本化更新下一次调度时间。claim lease
 * 防止多副本同时领取同一条记录，进程崩溃后由数据库按过期时间恢复。
 */
export class PaymentReconciliationWorker {
	private readonly logger: AppLogger;

	constructor(
		private readonly dependencies: {
			attempts: PaymentPrepayAttemptRepository;
			orders: PaymentOrderService;
			wechatPayment: WechatPaymentGateway;
			/** 微信查单确认收款后，继续执行旧服务的 HIS 回写边界。 */
			hospitalSettlement?: HospitalSettlementGateway;
			/** 从同一预约的已落库医保结算上下文解析 Provider 关联键。 */
			resolveRegistrationContext?: (input: {
				ownerUserId: string;
				appointmentId: string;
			}) => Promise<RegistrationSelfPaySettlementContext | undefined>;
			logger?: AppLogger;
		},
	) {
		this.logger = dependencies.logger ?? createNoopLogger();
	}

	private async completeHis(
		order: PaymentOrder,
		context: { traceId: string; idempotencyKey: string },
	): Promise<{ order: PaymentOrder; retry: boolean }> {
		const gateway = this.dependencies.hospitalSettlement;
		if (order.state === "his_written_back") {
			try {
				const completed = await this.dependencies.orders.transition(
					order.ownerUserId,
					order.orderId,
					"completed",
				);
				return { order: completed, retry: false };
			} catch (error) {
				this.logger.warn(
					{
						event: "worker.payment.his_writeback.retry_scheduled",
						orderId: order.orderId,
						errorName: error instanceof Error ? error.name : "UnknownError",
					},
					"Payment order completion will be retried",
				);
				return { order, retry: true };
			}
		}
		if (order.state !== "cash_paid") {
			return { order, retry: false };
		}
		const appointmentId = order.idempotencyKey.startsWith(
			REGISTRATION_SELF_PAY_ORDER_PREFIX,
		)
			? order.idempotencyKey.slice(REGISTRATION_SELF_PAY_ORDER_PREFIX.length)
			: undefined;
		if (!gateway) {
			this.logger.warn(
				{
					event: "worker.payment.his_writeback.retry_scheduled",
					orderId: order.orderId,
					reason: "hospital-settlement-not-configured",
				},
				"Payment order is paid but HIS writeback is not configured",
			);
			return { order, retry: true };
		}
		try {
			const registrationContext =
				this.dependencies.resolveRegistrationContext && appointmentId
					? await this.dependencies.resolveRegistrationContext({
							ownerUserId: order.ownerUserId,
							appointmentId,
						})
					: undefined;
			if (
				this.dependencies.resolveRegistrationContext &&
				!registrationContext
			) {
				this.logger.warn(
					{
						event: "worker.payment.his_context.retry_scheduled",
						orderId: order.orderId,
						reason: "registration-context-missing",
					},
					"Payment order HIS context is not available yet",
				);
				return { order, retry: true };
			}
			const trace = await gateway.writeBack(
				{
					orderId: order.orderId,
					settlement: {
						orderId: order.orderId,
						state: order.state,
						totalFen: order.amounts.totalFen,
						insuranceFen: order.amounts.insuranceFen,
						cashFen: order.amounts.cashFen,
						trace: [],
					},
					...(registrationContext ? { registrationContext } : {}),
				},
				{
					...context,
					idempotencyKey: `registration-self-pay-settlement:${order.orderId}`,
				},
			);
			const writtenBack = await this.dependencies.orders.transition(
				order.ownerUserId,
				order.orderId,
				"his_written_back",
			);
			const completed = await this.dependencies.orders.transition(
				order.ownerUserId,
				order.orderId,
				"completed",
			);
			this.logger.info(
				{
					event: "worker.payment.his_writeback.completed",
					orderId: completed.orderId,
					provider: trace.provider,
					providerRequestId: trace.requestId,
					previousVersion: order.version,
					writtenBackVersion: writtenBack.version,
					completedVersion: completed.version,
				},
				"Payment order HIS writeback completed",
			);
			return { order: completed, retry: false };
		} catch (error) {
			this.logger.warn(
				{
					event: "worker.payment.his_writeback.retry_scheduled",
					orderId: order.orderId,
					errorName: error instanceof Error ? error.name : "UnknownError",
				},
				"Payment order HIS writeback will be retried",
			);
			return { order, retry: true };
		}
	}

	async runOnce(now = new Date()): Promise<PaymentReconciliationWorkerResult> {
		const due = await this.dependencies.attempts.claimDueForQuery(
			now,
			QUERY_BATCH_SIZE,
			QUERY_CLAIM_LEASE_MS,
		);
		const attempt = due[0];
		if (!attempt) return "idle";

		const context = {
			traceId: `wechat-query:${attempt.attemptId}:${attempt.queryAttempts + 1}`,
			// 查单幂等键跨 worker 重启保持不变；GET 查询也需要可关联的调用上下文。
			idempotencyKey: `wechat-query:${attempt.attemptId}`,
		};

		try {
			const query = await this.dependencies.wechatPayment.query(
				{ orderId: attempt.orderId },
				context,
			);
			const reconciliation =
				await this.dependencies.orders.reconcileWechatPayment({
					orderId: attempt.orderId,
					state: query.state,
					totalFen: query.totalFen,
					trace: query.trace,
				});
			const his = await this.completeHis(reconciliation.order, context);
			const shouldContinue =
				his.retry ||
				(reconciliation.outcome === "unchanged" &&
					query.state === "cash_pending" &&
					(his.order.state === "cash_pending" ||
						his.order.state === "awaiting_confirmation"));
			const updatedAttempt = updateAttemptSchedule(attempt, now, {
				shouldContinue,
				...(shouldContinue
					? {
							lastErrorCode: his.retry
								? "his-writeback-pending"
								: "provider-pending",
						}
					: {}),
			});
			await this.dependencies.attempts.update(updatedAttempt, attempt.version);
			if (updatedAttempt.status === "manual_review") {
				this.logger.error(
					{
						event: "worker.payment.wechat_query.manual_review_required",
						attemptId: attempt.attemptId,
						orderId: attempt.orderId,
						queryAttempts: updatedAttempt.queryAttempts,
						maxAttempts: MAX_PAYMENT_QUERY_ATTEMPTS,
						providerState: query.state,
						orderState: his.order.state,
						reason: his.retry ? "his-writeback-pending" : "provider-pending",
					},
					"Wechat payment query requires manual review",
				);
				return "manual_review";
			}
			this.logger.info(
				{
					event: "worker.payment.wechat_query.reconciled",
					attemptId: attempt.attemptId,
					orderId: attempt.orderId,
					queryAttempts: updatedAttempt.queryAttempts,
					providerRequestId: query.trace.requestId,
					providerState: query.state,
					outcome: reconciliation.outcome,
					shouldContinue,
				},
				"Wechat payment query reconciled",
			);
			return "reconciled";
		} catch (error) {
			const providerFailure = providerFailureMetadata(error);
			const providerOrderNotFound =
				providerFailure.providerFailureReason === "payment-order-not-found";
			const retryAttempt = updateAttemptSchedule(attempt, now, {
				shouldContinue: !providerOrderNotFound,
				...(providerOrderNotFound
					? {
							status: "failed" as const,
							lastErrorCode: "provider-order-not-found",
						}
					: { lastErrorCode: "provider-query-failed" }),
			});
			await this.dependencies.attempts
				.update(retryAttempt, attempt.version)
				.catch(() => undefined);
			if (providerOrderNotFound) {
				this.logger.warn(
					{
						event: "worker.payment.wechat_query.order_not_found",
						attemptId: attempt.attemptId,
						orderId: attempt.orderId,
						queryAttempts: retryAttempt.queryAttempts,
						outcome: "retryable_failed",
						...providerFailure,
					},
					"Wechat payment order was not found; prepay can be retried",
				);
				return "failed";
			}
			if (retryAttempt.status === "manual_review") {
				this.logger.error(
					{
						event: "worker.payment.wechat_query.manual_review_required",
						attemptId: attempt.attemptId,
						orderId: attempt.orderId,
						queryAttempts: retryAttempt.queryAttempts,
						maxAttempts: MAX_PAYMENT_QUERY_ATTEMPTS,
						reason: "provider-query-failed",
						errorName: error instanceof Error ? error.name : "UnknownError",
					},
					"Wechat payment query requires manual review",
				);
				return "manual_review";
			}
			this.logger.warn(
				{
					event: "worker.payment.wechat_query.retry_scheduled",
					attemptId: attempt.attemptId,
					orderId: attempt.orderId,
					queryAttempts: retryAttempt.queryAttempts,
					errorName: error instanceof Error ? error.name : "UnknownError",
					...providerFailureMetadata(error),
				},
				"Wechat payment query will be retried",
			);
			return "retry_scheduled";
		}
	}
}
