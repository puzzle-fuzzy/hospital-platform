import type {
	MedicalInsuranceGateway,
	MedicalInsuranceQueryTask,
	MedicalInsuranceQueryTaskRepository,
	MedicalInsuranceSettlementEvidenceFinality,
	PaymentOrderService,
} from "@hospital/domain";
import { createNoopLogger, type AppLogger } from "@hospital/observability";

export type {
	MedicalInsuranceQueryTask,
	MedicalInsuranceQueryTaskRepository,
} from "@hospital/domain";

const BASE_QUERY_DELAY_MS = 15_000;
const MAX_QUERY_DELAY_MS = 15 * 60 * 1000;
const QUERY_BATCH_SIZE = 1;
const QUERY_CLAIM_LEASE_MS = 60_000;

/** 医保查单与微信查单一样，必须有持久化任务和明确的人工接管上限。 */
export const MAX_MEDICAL_INSURANCE_QUERY_ATTEMPTS = 12;

export type MedicalInsuranceReconciliationWorkerResult =
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

function updateTask(
	task: MedicalInsuranceQueryTask,
	now: Date,
	options: {
		continueQuery: boolean;
		manualReview?: boolean;
		lastErrorCode?: string;
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

/**
 * 医保 6301/6302 查单补偿 Worker。
 *
 * 它只处理“查单任务”和受控证据，不调用 6201/6202 重建订单，也不把
 * `success=true`、HTTP 200 或 ordStas=1/6 直接当作支付成功。最终 paid
 * 证据仍由领域层要求来自 Yunhealth/HIS；本文件暂不接入生产 runtime。
 */
export class MedicalInsuranceReconciliationWorker {
	private readonly logger: AppLogger;

	constructor(
		private readonly dependencies: {
			tasks: MedicalInsuranceQueryTaskRepository;
			orders: PaymentOrderService;
			medicalInsurance: MedicalInsuranceGateway;
			logger?: AppLogger;
		},
	) {
		this.logger = dependencies.logger ?? createNoopLogger();
	}

	async runOnce(
		now = new Date(),
	): Promise<MedicalInsuranceReconciliationWorkerResult> {
		const due = await this.dependencies.tasks.claimDueForQuery(
			now,
			QUERY_BATCH_SIZE,
			QUERY_CLAIM_LEASE_MS,
		);
		const task = due[0];
		if (!task) return "idle";

		const context = {
			traceId: `medical-query:${task.taskId}:${task.attempts + 1}`,
			// 查单幂等键跨重启保持不变；不能因为 timeout 重建 6201/6202。
			idempotencyKey: `medical-query:${task.taskId}`,
		};

		try {
			const evidence = await this.dependencies.medicalInsurance.query(
				{ orderId: task.medicalOrderId },
				context,
			);
			const reconciliation =
				await this.dependencies.orders.reconcileMedicalInsuranceSettlement({
					orderId: task.medicalOrderId,
					...evidence,
				});
			const continueQuery = isNonTerminalEvidence(evidence.finality);
			const needsManualReview =
				!continueQuery && reconciliation.outcome === "awaiting_confirmation";
			const updatedTask = updateTask(task, now, {
				continueQuery,
				manualReview: needsManualReview,
				...(continueQuery
					? { lastErrorCode: "provider-pending" }
					: needsManualReview
						? { lastErrorCode: "evidence-needs-review" }
						: {}),
			});
			await this.dependencies.tasks.update(updatedTask, task.version);

			if (updatedTask.status === "manual_review") {
				this.logger.error(
					{
						event: "worker.payment.medical_query.manual_review_required",
						taskId: task.taskId,
						orderId: task.medicalOrderId,
						queryAttempts: updatedTask.attempts,
						maxAttempts: MAX_MEDICAL_INSURANCE_QUERY_ATTEMPTS,
						providerStatus: evidence.providerStatus,
						reason: updatedTask.lastErrorCode,
					},
					"Medical insurance query requires manual review",
				);
				return "manual_review";
			}
			if (continueQuery) {
				this.logger.info(
					{
						event: "worker.payment.medical_query.retry_scheduled",
						taskId: task.taskId,
						orderId: task.medicalOrderId,
						queryAttempts: updatedTask.attempts,
						providerRequestId: evidence.trace.requestId,
						providerStatus: evidence.providerStatus,
					},
					"Medical insurance query will be retried",
				);
				return "retry_scheduled";
			}
			this.logger.info(
				{
					event: "worker.payment.medical_query.reconciled",
					taskId: task.taskId,
					orderId: task.medicalOrderId,
					queryAttempts: updatedTask.attempts,
					providerRequestId: evidence.trace.requestId,
					providerStatus: evidence.providerStatus,
					outcome: reconciliation.outcome,
				},
				"Medical insurance query reconciled",
			);
			return "reconciled";
		} catch (error) {
			const retryTask = updateTask(task, now, {
				continueQuery: true,
				lastErrorCode: "provider-query-failed",
			});
			await this.dependencies.tasks
				.update(retryTask, task.version)
				.catch(() => undefined);
			if (retryTask.status === "manual_review") {
				this.logger.error(
					{
						event: "worker.payment.medical_query.manual_review_required",
						taskId: task.taskId,
						orderId: task.medicalOrderId,
						queryAttempts: retryTask.attempts,
						maxAttempts: MAX_MEDICAL_INSURANCE_QUERY_ATTEMPTS,
						reason: "provider-query-failed",
						errorName: error instanceof Error ? error.name : "UnknownError",
					},
					"Medical insurance query requires manual review",
				);
				return "manual_review";
			}
			this.logger.warn(
				{
					event: "worker.payment.medical_query.retry_scheduled",
					taskId: task.taskId,
					orderId: task.medicalOrderId,
					queryAttempts: retryTask.attempts,
					errorName: error instanceof Error ? error.name : "UnknownError",
				},
				"Medical insurance query will be retried",
			);
			return "retry_scheduled";
		}
	}
}
