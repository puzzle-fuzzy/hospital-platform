import {
	assertPaymentSyncIdentifier,
	type PaymentReconciliationOutcome,
	type PaymentReconciliationResult,
	type PaymentSyncKind,
	type PaymentSyncRepository,
	type PaymentSyncSource,
	type PaymentSyncTask,
	type PaymentSyncTaskClaimQuery,
} from "./payment-sync";

export type PaymentSyncObservation = {
	observationKey: string;
	observed: boolean;
	observedAmountFen?: number;
	observedStatus?: string;
	evidenceDigest: string;
	observedAt: string;
};

export type PaymentSyncCoordinatorDependencies = {
	repository: PaymentSyncRepository;
	now?: () => Date;
	createId?: () => string;
};

export type EnqueuePaymentSyncTaskInput = {
	aggregateId: string;
	businessKey: string;
	source: PaymentSyncSource;
	kind: PaymentSyncKind;
	maxAttempts?: number;
	nextRunAt?: string;
};

function boundedReason(value: string): string {
	return value.length > 128 ? value.slice(0, 128) : value;
}

function assertFen(value: number | undefined, label: string): void {
	if (value !== undefined && (!Number.isSafeInteger(value) || value < 0)) {
		throw new Error(`${label} is invalid`);
	}
}

function reconciliationOutcome(input: {
	observation: PaymentSyncObservation;
	expectedAmountFen?: number;
	expectedStatus?: string;
}): {
	outcome: PaymentReconciliationOutcome;
	amountDeltaFen?: number;
} {
	if (!input.observation.observed) return { outcome: "missing" };
	const amountDeltaFen =
		input.expectedAmountFen !== undefined &&
		input.observation.observedAmountFen !== undefined
			? input.observation.observedAmountFen - input.expectedAmountFen
			: undefined;
	if (amountDeltaFen !== undefined && amountDeltaFen !== 0) {
		return { outcome: "amount_mismatch", amountDeltaFen };
	}
	if (
		input.expectedStatus !== undefined &&
		input.observation.observedStatus !== undefined &&
		input.expectedStatus !== input.observation.observedStatus
	) {
		return { outcome: "status_mismatch" };
	}
	return { outcome: "matched" };
}

/**
 * 平台支付同步/对账的无 Provider 编排层。
 *
 * 真实 HIS、医保和微信适配器只允许把已验证的观测事实交给这里；本层
 * 不访问外部系统，也不修改支付聚合单终态。任何缺失、金额差异或状态差异
 * 都进入人工复核，避免把“任务完成”误当成“支付成功”。
 */
export class PaymentSyncCoordinator {
	private readonly now: () => Date;
	private readonly createId: () => string;

	constructor(
		private readonly dependencies: PaymentSyncCoordinatorDependencies,
	) {
		this.now = dependencies.now ?? (() => new Date());
		this.createId = dependencies.createId ?? (() => crypto.randomUUID());
	}

	async enqueue(input: EnqueuePaymentSyncTaskInput): Promise<PaymentSyncTask> {
		const aggregateId = assertPaymentSyncIdentifier(
			input.aggregateId,
			"aggregateId",
		);
		const businessKey = assertPaymentSyncIdentifier(
			input.businessKey,
			"businessKey",
		);
		const maxAttempts = input.maxAttempts ?? 3;
		if (
			!Number.isSafeInteger(maxAttempts) ||
			maxAttempts < 1 ||
			maxAttempts > 20
		) {
			throw new Error("maxAttempts is invalid");
		}
		if (
			input.nextRunAt !== undefined &&
			Number.isNaN(Date.parse(input.nextRunAt))
		) {
			throw new Error("nextRunAt is invalid");
		}
		const existing = await this.dependencies.repository.findTaskByKey(
			aggregateId,
			businessKey,
			input.source,
			input.kind,
		);
		if (existing) return existing;
		const now = this.now().toISOString();
		return this.dependencies.repository.enqueueTask({
			taskId: `paysync-${this.createId()}`,
			aggregateId,
			businessKey,
			source: input.source,
			kind: input.kind,
			status: "pending",
			attempts: 0,
			maxAttempts,
			nextRunAt: input.nextRunAt ?? now,
			claimedUntil: null,
			lastErrorCode: null,
			resultDigest: null,
			version: 1,
			createdAt: now,
			updatedAt: now,
		});
	}

	claimDue(
		now: Date,
		limit = 20,
		leaseMs = 60_000,
		query: PaymentSyncTaskClaimQuery = {},
	): Promise<readonly PaymentSyncTask[]> {
		const businessKeyPrefix = query.businessKeyPrefix
			? assertPaymentSyncIdentifier(
					query.businessKeyPrefix,
					"businessKeyPrefix",
				)
			: undefined;
		return this.dependencies.repository.claimDueTasks(now, limit, leaseMs, {
			...(query.source ? { source: query.source } : {}),
			...(query.kind ? { kind: query.kind } : {}),
			...(businessKeyPrefix ? { businessKeyPrefix } : {}),
		});
	}

	async recordObservation(input: {
		task: PaymentSyncTask;
		expectedAmountFen?: number;
		expectedStatus?: string;
		observation: PaymentSyncObservation;
	}): Promise<PaymentReconciliationResult> {
		if (input.task.status !== "in_progress") {
			throw new Error("Payment sync task is not claimed");
		}
		assertFen(input.expectedAmountFen, "expectedAmountFen");
		assertFen(input.observation.observedAmountFen, "observedAmountFen");
		assertPaymentSyncIdentifier(
			input.observation.observationKey,
			"observationKey",
		);
		assertPaymentSyncIdentifier(
			input.observation.evidenceDigest,
			"evidenceDigest",
		);
		const comparison = reconciliationOutcome(input);
		const now = this.now().toISOString();
		const result: PaymentReconciliationResult = {
			resultId: `payrecon-${this.createId()}`,
			aggregateId: input.task.aggregateId,
			source: input.task.source,
			observationKey: input.observation.observationKey,
			outcome: comparison.outcome,
			...(input.expectedAmountFen !== undefined
				? { expectedAmountFen: input.expectedAmountFen }
				: {}),
			...(input.observation.observedAmountFen !== undefined
				? { observedAmountFen: input.observation.observedAmountFen }
				: {}),
			...(comparison.amountDeltaFen !== undefined
				? { amountDeltaFen: comparison.amountDeltaFen }
				: {}),
			...(input.expectedStatus !== undefined
				? { expectedStatus: input.expectedStatus }
				: {}),
			...(input.observation.observedStatus !== undefined
				? { observedStatus: input.observation.observedStatus }
				: {}),
			resolution:
				comparison.outcome === "matched" ? "resolved" : "manual_review",
			evidenceDigest: input.observation.evidenceDigest,
			observedAt: input.observation.observedAt,
			createdAt: now,
		};
		const stored =
			await this.dependencies.repository.appendReconciliation(result);
		await this.dependencies.repository.updateTask(
			{
				...input.task,
				status:
					comparison.outcome === "matched" ? "succeeded" : "manual_review",
				attempts: input.task.attempts + 1,
				claimedUntil: null,
				lastErrorCode:
					comparison.outcome === "matched"
						? null
						: `reconciliation-${comparison.outcome}`,
				resultDigest: input.observation.evidenceDigest,
				version: input.task.version + 1,
				updatedAt: now,
			},
			input.task.version,
		);
		return stored;
	}

	async markFailure(input: {
		task: PaymentSyncTask;
		reasonCode: string;
		nextRunAt?: string;
	}): Promise<PaymentSyncTask> {
		if (input.task.status !== "in_progress") {
			throw new Error("Payment sync task is not claimed");
		}
		const attempts = input.task.attempts + 1;
		const now = this.now().toISOString();
		const terminal = attempts >= input.task.maxAttempts;
		return this.dependencies.repository.updateTask(
			{
				...input.task,
				status: terminal ? "manual_review" : "pending",
				attempts,
				claimedUntil: null,
				lastErrorCode: boundedReason(input.reasonCode),
				version: input.task.version + 1,
				nextRunAt: input.nextRunAt ?? now,
				updatedAt: now,
			},
			input.task.version,
		);
	}

	async markManualReview(input: {
		task: PaymentSyncTask;
		reasonCode: string;
	}): Promise<PaymentSyncTask> {
		if (input.task.status !== "in_progress") {
			throw new Error("Payment sync task is not claimed");
		}
		const now = this.now().toISOString();
		return this.dependencies.repository.updateTask(
			{
				...input.task,
				status: "manual_review",
				attempts: input.task.attempts + 1,
				claimedUntil: null,
				lastErrorCode: boundedReason(input.reasonCode),
				version: input.task.version + 1,
				nextRunAt: now,
				updatedAt: now,
			},
			input.task.version,
		);
	}
}
