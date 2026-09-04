import type {
	PaymentOrderService,
	PaymentPrepayAttempt,
	PaymentPrepayAttemptRepository,
	WechatPaymentGateway,
} from "@hospital/domain";
import {
	createNoopLogger,
	providerFailureMetadata,
	type AppLogger,
} from "@hospital/observability";

/** 首次明确未支付后给 provider 的最小重试间隔。 */
const BASE_QUERY_DELAY_MS = 15_000;
/** provider 故障时的查单退避上限，避免 worker 形成高频风暴。 */
const MAX_QUERY_DELAY_MS = 15 * 60 * 1000;
/** 每次 worker tick 只领取一条，保证数据库版本和 provider 请求边界清晰。 */
const QUERY_BATCH_SIZE = 1;
/** provider 查询异常或进程崩溃后的 claim 接管窗口。 */
const QUERY_CLAIM_LEASE_MS = 60_000;
/**
 * 微信查单自动重试上限；达到上限后必须停在 manual_review，等待人工核对，
 * 不能继续制造没有边界的 provider 请求。
 */
export const MAX_PAYMENT_QUERY_ATTEMPTS = 12;

export type PaymentReconciliationWorkerResult =
	| "idle"
	| "reconciled"
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
	options: { shouldContinue: boolean; lastErrorCode?: string },
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
		status: exhausted ? "manual_review" : attempt.status,
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
			logger?: AppLogger;
		},
	) {
		this.logger = dependencies.logger ?? createNoopLogger();
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
			const shouldContinue =
				reconciliation.outcome === "unchanged" &&
				query.state === "cash_pending" &&
				(reconciliation.order.state === "cash_pending" ||
					reconciliation.order.state === "awaiting_confirmation");
			const updatedAttempt = updateAttemptSchedule(attempt, now, {
				shouldContinue,
				...(shouldContinue ? { lastErrorCode: "provider-pending" } : {}),
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
						reason: "provider-pending",
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
			const retryAttempt = updateAttemptSchedule(attempt, now, {
				shouldContinue: true,
				lastErrorCode: "provider-query-failed",
			});
			await this.dependencies.attempts
				.update(retryAttempt, attempt.version)
				.catch(() => undefined);
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
