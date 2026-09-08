import type {
	AdapterCallContext,
	MedicalInsuranceOrder,
	MedicalInsuranceOrderRepository,
	MedicalInsuranceQueryTask,
	MedicalInsuranceQueryTaskRepository,
	MedicalInsuranceSettlementEvidence,
	MedicalInsuranceSettlementEvidenceFinality,
	MedicalInsuranceWechatPaymentGateway,
} from "@hospital/domain";
import {
	assertMedicalInsuranceOrderTransition,
	MAX_MEDICAL_INSURANCE_QUERY_ATTEMPTS,
} from "@hospital/domain";
import {
	type AppLogger,
	createNoopLogger,
	providerFailureMetadata,
} from "@hospital/observability";

/** 新医保订单域使用 owner-scoped 查询参数，不能复用旧 PaymentOrder worker。 */
export type MedicalInsuranceOrderQueryGateway = {
	query(
		input: { orderId: string; ownerUserId: string },
		context: AdapterCallContext,
	): Promise<MedicalInsuranceSettlementEvidence>;
};

const BASE_QUERY_DELAY_MS = 15_000;
const MAX_QUERY_DELAY_MS = 15 * 60 * 1000;
const QUERY_BATCH_SIZE = 1;
const QUERY_CLAIM_LEASE_MS = 60_000;

export type MedicalInsuranceOrderReconciliationWorkerResult =
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

function isNonTerminalEvidence(
	finality: MedicalInsuranceSettlementEvidenceFinality,
): boolean {
	return (
		finality === "processing" ||
		finality === "settlement_candidate" ||
		finality === "unknown"
	);
}

function taskAfterQuery(
	task: MedicalInsuranceQueryTask,
	now: Date,
	options: {
		continueQuery: boolean;
		manualReview?: boolean;
		lastErrorCode?: string;
		terminalOrdStas?: string;
	},
): MedicalInsuranceQueryTask {
	const {
		claimedUntil: _previousClaimedUntil,
		lastErrorCode: _previousLastErrorCode,
		...withoutSchedule
	} = task;
	const attempts = Math.min(Number.MAX_SAFE_INTEGER, task.attempts + 1);
	const exhausted =
		options.continueQuery &&
		attempts >=
			Math.min(task.maxAttempts, MAX_MEDICAL_INSURANCE_QUERY_ATTEMPTS);
	const manualReview = options.manualReview || exhausted;
	return {
		...withoutSchedule,
		status: manualReview
			? "manual_review"
			: options.continueQuery
				? "pending"
				: "completed",
		attempts,
		claimedUntil: null,
		lastErrorCode: options.lastErrorCode ?? null,
		terminalOrdStas: options.terminalOrdStas ?? task.terminalOrdStas,
		version: task.version + 1,
		updatedAt: now.toISOString(),
		...(options.continueQuery && !manualReview
			? {
					nextAttemptAt: new Date(
						now.getTime() + queryDelayMs(task.attempts),
					).toISOString(),
				}
			: {}),
	};
}

function sameAmounts(
	order: MedicalInsuranceOrder,
	evidence: MedicalInsuranceSettlementEvidence,
): boolean {
	if (!order.amounts) return false;
	return (
		order.amounts.totalFen === evidence.amounts.totalFen &&
		order.amounts.cashFen === evidence.amounts.cashFen &&
		order.amounts.personalAccountFen + order.amounts.fundFen ===
			evidence.amounts.insuranceFen
	);
}

function reconciliationFailureCode(error: unknown): string | undefined {
	if (!(error instanceof Error)) return undefined;
	if (
		error.message === "medical order version conflict" ||
		error.message === "Medical insurance query task changed by another worker"
	) {
		return "concurrent-state-change";
	}
	return undefined;
}

function candidateState(
	evidence: MedicalInsuranceSettlementEvidence,
): MedicalInsuranceOrder["status"] {
	if (evidence.finality === "failed" || evidence.finality === "cancelled") {
		return evidence.authoritative ? "failed" : "awaiting_confirmation";
	}
	if (
		evidence.finality === "paid" &&
		evidence.authoritative &&
		evidence.source === "yunhealth"
	) {
		return evidence.amounts.cashFen > 0 ? "cash_pending" : "insurance_settled";
	}
	return "awaiting_confirmation";
}

/** 返回可安全应用的订单状态；不允许查单把终态静默改回处理中。 */
function safeNextState(
	order: MedicalInsuranceOrder,
	candidate: MedicalInsuranceOrder["status"],
): MedicalInsuranceOrder["status"] {
	if (candidate === order.status) return candidate;
	try {
		assertMedicalInsuranceOrderTransition(order.status, candidate);
		return candidate;
	} catch {
		if (order.status === "manual_review") return "manual_review";
		return "manual_review";
	}
}

/**
 * 新医保订单域的 6301/6302 补偿 Worker。
 *
 * 旧的 `MedicalInsuranceReconciliationWorker` 面向历史 PaymentOrder 聚合，
 * 不能直接消费 `hp_medical_insurance_orders`；本 Worker 使用同一张查单任务表，
 * 但通过 owner-scoped 医保订单仓储和安全凭证 gateway 完成真正的订单回写。
 */
export class MedicalInsuranceOrderReconciliationWorker {
	private readonly logger: AppLogger;

	constructor(
		private readonly dependencies: {
			tasks: MedicalInsuranceQueryTaskRepository;
			orders: MedicalInsuranceOrderRepository;
			medicalInsurance: MedicalInsuranceOrderQueryGateway;
			wechatPayment?: MedicalInsuranceWechatPaymentGateway;
			completeWechatPayment?: (
				input: {
					ownerUserId: string;
					medicalOrderId: string;
					paymentOrderId: string;
				},
				context: AdapterCallContext,
			) => Promise<boolean>;
			logger?: AppLogger;
		},
	) {
		this.logger = dependencies.logger ?? createNoopLogger();
	}

	private async updateTask(
		task: MedicalInsuranceQueryTask,
		now: Date,
		options: Parameters<typeof taskAfterQuery>[2],
	): Promise<MedicalInsuranceQueryTask> {
		const updated = taskAfterQuery(task, now, options);
		return this.dependencies.tasks.update(updated, task.version);
	}

	private async reconcileWechatMixedOrder(
		task: MedicalInsuranceQueryTask,
		order: MedicalInsuranceOrder,
		now: Date,
		context: AdapterCallContext,
	): Promise<MedicalInsuranceOrderReconciliationWorkerResult> {
		const gateway = this.dependencies.wechatPayment;
		if (
			!gateway ||
			!order.wechatMixTradeNo ||
			!order.wechatOutTradeNo ||
			!order.payOrdId ||
			!order.amounts
		) {
			await this.updateTask(task, now, {
				continueQuery: false,
				manualReview: true,
				lastErrorCode: "wechat-mixed-query-context-missing",
			});
			this.logger.error(
				{
					event: "worker.payment.medical_wechat_query.manual_review_required",
					taskId: task.taskId,
					orderId: order.medicalOrderId,
					reason: "wechat-mixed-query-context-missing",
				},
				"Medical insurance WeChat mixed order requires manual review",
			);
			return "manual_review";
		}
		const result = await gateway.queryMixedOrder(
			{
				orderId: order.medicalOrderId,
				mixTradeNo: order.wechatMixTradeNo,
				expectedOutTradeNo: order.wechatOutTradeNo,
				expectedPayOrdId: order.payOrdId,
				expectedTotalFen: order.amounts.totalFen,
				expectedCashFen: order.amounts.cashFen,
			},
			context,
		);
		const fullyPaid =
			result.cashState === "paid" && result.insuranceState === "paid";
		const providerFailed =
			result.cashState === "failed" || result.insuranceState === "failed";
		const paymentState = fullyPaid
			? "cash_paid"
			: providerFailed
				? "failed"
				: result.cashState === "paid"
					? "unknown"
					: "prepay_ready";
		const updated = await this.dependencies.orders.applySettlement(
			order.medicalOrderId,
			order.version,
			{
				status: providerFailed ? "manual_review" : order.status,
				ordStas: order.ordStas,
				amounts: order.amounts,
				setlType: order.setlType,
				revsTokenHash: order.revsTokenHash,
				revsTokenExpiresAt: order.revsTokenExpiresAt,
				wechatPaymentState: paymentState,
				medInsFailReason:
					result.medInsPayStatus === "MED_INS_PAY_FAIL"
						? (result.medInsFailReason ?? null)
						: null,
			},
		);
		if (!updated) throw new Error("medical order version conflict");
		let hisCompleted = false;
		if (fullyPaid) {
			const settlement = await this.dependencies.orders.getSettlementContext(
				order.ownerUserId,
				order.medicalOrderId,
			);
			if (
				settlement?.plugin?.paymentOrderId &&
				this.dependencies.completeWechatPayment
			) {
				hisCompleted = await this.dependencies.completeWechatPayment(
					{
						ownerUserId: order.ownerUserId,
						medicalOrderId: order.medicalOrderId,
						paymentOrderId: settlement.plugin.paymentOrderId,
					},
					context,
				);
			}
		}
		const continueQuery =
			(!fullyPaid && !providerFailed) || (fullyPaid && !hisCompleted);
		const updatedTask = await this.updateTask(task, now, {
			continueQuery,
			manualReview: providerFailed,
			...(providerFailed
				? { lastErrorCode: "wechat-mixed-payment-failed" }
				: fullyPaid && hisCompleted
					? {}
					: fullyPaid
						? { lastErrorCode: "wechat-mixed-his-writeback-pending" }
						: { lastErrorCode: "wechat-mixed-payment-pending" }),
			terminalOrdStas: result.providerStatus,
		});
		if (updatedTask.status === "manual_review" && !providerFailed) {
			await this.dependencies.orders.applySettlement(
				updated.medicalOrderId,
				updated.version,
				{
					status: "manual_review",
					ordStas: updated.ordStas,
					amounts: updated.amounts,
					setlType: updated.setlType,
					revsTokenHash: updated.revsTokenHash,
					revsTokenExpiresAt: updated.revsTokenExpiresAt,
					wechatPaymentState: updated.wechatPaymentState,
				},
			);
		}
		this.logger[providerFailed ? "error" : "info"](
			{
				event: providerFailed
					? "worker.payment.medical_wechat_query.manual_review_required"
					: fullyPaid && hisCompleted
						? "worker.payment.medical_wechat_query.confirmed"
						: "worker.payment.medical_wechat_query.retry_scheduled",
				taskId: task.taskId,
				orderId: order.medicalOrderId,
				queryAttempts: updatedTask.attempts,
				providerRequestId: result.trace.requestId,
				providerStatus: result.providerStatus,
				cashState: result.cashState,
				insuranceState: result.insuranceState,
				medInsPayStatus: result.medInsPayStatus,
				...(result.medInsFailReason
					? { medInsFailReason: result.medInsFailReason }
					: {}),
			},
			"Medical insurance WeChat mixed order reconciled",
		);
		return providerFailed
			? "manual_review"
			: fullyPaid && hisCompleted
				? "reconciled"
				: updatedTask.status === "manual_review"
					? "manual_review"
					: "retry_scheduled";
	}

	async runOnce(
		now = new Date(),
	): Promise<MedicalInsuranceOrderReconciliationWorkerResult> {
		const due = await this.dependencies.tasks.claimDueForQuery(
			now,
			QUERY_BATCH_SIZE,
			QUERY_CLAIM_LEASE_MS,
		);
		const task = due[0];
		if (!task) return "idle";

		const context: AdapterCallContext = {
			traceId: `medical-order-query:${task.taskId}:${task.attempts + 1}`,
			idempotencyKey: `medical-order-query:${task.taskId}`,
		};

		try {
			const order = await this.dependencies.orders.findByMedicalOrderId(
				task.medicalOrderId,
			);
			if (!order) {
				await this.updateTask(task, now, {
					continueQuery: false,
					manualReview: true,
					lastErrorCode: "medical-order-not-found",
				});
				this.logger.error(
					{
						event: "worker.payment.medical_order_query.manual_review_required",
						taskId: task.taskId,
						orderId: task.medicalOrderId,
						reason: "medical-order-not-found",
					},
					"Medical insurance order query requires manual review",
				);
				return "manual_review";
			}
			if (order.status === "manual_review") {
				const updatedTask = await this.updateTask(task, now, {
					continueQuery: false,
					manualReview: true,
					lastErrorCode: "order-already-manual-review",
				});
				this.logger.error(
					{
						event: "worker.payment.medical_order_query.manual_review_required",
						taskId: task.taskId,
						orderId: task.medicalOrderId,
						queryAttempts: updatedTask.attempts,
						reason: updatedTask.lastErrorCode,
					},
					"Medical insurance order query requires manual review",
				);
				return "manual_review";
			}
			if (order.status === "cash_pending" && order.wechatMixTradeNo) {
				return await this.reconcileWechatMixedOrder(task, order, now, context);
			}
			if (
				order.status === "insurance_settled" ||
				order.status === "cash_pending" ||
				order.status === "failed"
			) {
				await this.updateTask(task, now, {
					continueQuery: false,
					lastErrorCode: `order-already-${order.status}`,
				});
				this.logger.info(
					{
						event:
							"worker.payment.medical_order_query.completed_terminal_order",
						taskId: task.taskId,
						orderId: task.medicalOrderId,
						status: order.status,
					},
					"Medical insurance query task closed for terminal order",
				);
				return "reconciled";
			}
			if (!order.amounts) {
				await this.updateTask(task, now, {
					continueQuery: false,
					manualReview: true,
					lastErrorCode: "medical-order-amounts-missing",
				});
				this.logger.error(
					{
						event: "worker.payment.medical_order_query.manual_review_required",
						taskId: task.taskId,
						orderId: task.medicalOrderId,
						reason: "medical-order-amounts-missing",
					},
					"Medical insurance order query requires manual review",
				);
				return "manual_review";
			}

			const evidence = await this.dependencies.medicalInsurance.query(
				{ orderId: order.medicalOrderId, ownerUserId: order.ownerUserId },
				context,
			);
			const amountsMatch = sameAmounts(order, evidence);
			const nonTerminal = isNonTerminalEvidence(evidence.finality);
			const requestedState = safeNextState(
				order,
				amountsMatch ? candidateState(evidence) : "awaiting_confirmation",
			);
			const transitionNeedsReview = requestedState === "manual_review";
			if (requestedState !== order.status) {
				const updated = await this.dependencies.orders.applySettlement(
					order.medicalOrderId,
					order.version,
					{
						status: requestedState,
						ordStas: evidence.providerStatus,
						amounts: order.amounts,
						setlType: order.amounts.cashFen > 0 ? "CASH" : "ALL",
						revsTokenHash: order.revsTokenHash,
						revsTokenExpiresAt: order.revsTokenExpiresAt,
					},
				);
				if (!updated) throw new Error("medical order version conflict");
			}

			const needsManualReview =
				transitionNeedsReview || (!nonTerminal && !amountsMatch);
			const taskOptions: Parameters<typeof taskAfterQuery>[2] = {
				continueQuery: nonTerminal && !transitionNeedsReview,
				manualReview: needsManualReview,
			};
			const lastErrorCode = nonTerminal
				? "provider-pending"
				: !amountsMatch
					? "evidence-amount-mismatch"
					: transitionNeedsReview
						? "invalid-order-transition"
						: undefined;
			if (lastErrorCode) taskOptions.lastErrorCode = lastErrorCode;
			if (!nonTerminal) taskOptions.terminalOrdStas = evidence.providerStatus;
			const updatedTask = await this.updateTask(task, now, taskOptions);

			if (updatedTask.status === "manual_review") {
				this.logger.error(
					{
						event: "worker.payment.medical_order_query.manual_review_required",
						taskId: task.taskId,
						orderId: task.medicalOrderId,
						queryAttempts: updatedTask.attempts,
						maxAttempts: MAX_MEDICAL_INSURANCE_QUERY_ATTEMPTS,
						providerStatus: evidence.providerStatus,
						reason: updatedTask.lastErrorCode,
					},
					"Medical insurance order query requires manual review",
				);
				return "manual_review";
			}
			if (nonTerminal) {
				this.logger.info(
					{
						event: "worker.payment.medical_order_query.retry_scheduled",
						taskId: task.taskId,
						orderId: task.medicalOrderId,
						queryAttempts: updatedTask.attempts,
						providerRequestId: evidence.trace.requestId,
						providerStatus: evidence.providerStatus,
					},
					"Medical insurance order query will be retried",
				);
				return "retry_scheduled";
			}
			this.logger.info(
				{
					event: "worker.payment.medical_order_query.reconciled",
					taskId: task.taskId,
					orderId: task.medicalOrderId,
					queryAttempts: updatedTask.attempts,
					providerRequestId: evidence.trace.requestId,
					providerStatus: evidence.providerStatus,
				},
				"Medical insurance order query reconciled",
			);
			return "reconciled";
		} catch (error) {
			const failureCode = reconciliationFailureCode(error);
			const retryTask = taskAfterQuery(task, now, {
				continueQuery: true,
				lastErrorCode: "provider-query-failed",
			});
			await this.dependencies.tasks
				.update(retryTask, task.version)
				.catch(() => undefined);
			if (retryTask.status === "manual_review") {
				this.logger.error(
					{
						event: "worker.payment.medical_order_query.manual_review_required",
						taskId: task.taskId,
						orderId: task.medicalOrderId,
						queryAttempts: retryTask.attempts,
						maxAttempts: MAX_MEDICAL_INSURANCE_QUERY_ATTEMPTS,
						reason: "provider-query-failed",
						errorName: error instanceof Error ? error.name : "UnknownError",
						...(failureCode ? { failureCode } : {}),
						...providerFailureMetadata(error),
					},
					"Medical insurance order query requires manual review",
				);
				return "manual_review";
			}
			this.logger.warn(
				{
					event: "worker.payment.medical_order_query.retry_scheduled",
					taskId: task.taskId,
					orderId: task.medicalOrderId,
					queryAttempts: retryTask.attempts,
					errorName: error instanceof Error ? error.name : "UnknownError",
					...(failureCode ? { failureCode } : {}),
					...providerFailureMetadata(error),
				},
				"Medical insurance order query will be retried",
			);
			return "retry_scheduled";
		}
	}
}
