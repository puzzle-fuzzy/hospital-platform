import { isBoundedOpaqueIdentifier } from "./opaque-identifier";

export type PaymentSyncSource = "his" | "medical_insurance" | "wechat_pay";
export type PaymentSyncKind = "pull" | "reconcile" | "writeback";
export type PaymentSyncTaskStatus =
	| "pending"
	| "in_progress"
	| "succeeded"
	| "failed"
	| "manual_review";

export type PaymentSyncTask = {
	taskId: string;
	aggregateId: string;
	businessKey: string;
	source: PaymentSyncSource;
	kind: PaymentSyncKind;
	status: PaymentSyncTaskStatus;
	attempts: number;
	maxAttempts: number;
	nextRunAt: string;
	claimedUntil: string | null;
	lastErrorCode: string | null;
	resultDigest: string | null;
	version: number;
	createdAt: string;
	updatedAt: string;
};

export type PaymentSyncTaskListQuery = {
	limit: number;
	status?: PaymentSyncTaskStatus;
	source?: PaymentSyncSource;
	kind?: PaymentSyncKind;
	aggregateId?: string;
};

export type PaymentReconciliationSource =
	| "his"
	| "medical_insurance"
	| "wechat_pay";
export type PaymentReconciliationOutcome =
	| "matched"
	| "amount_mismatch"
	| "status_mismatch"
	| "missing"
	| "manual_review";
export type PaymentReconciliationResolution =
	| "open"
	| "resolved"
	| "manual_review";

export type PaymentReconciliationResult = {
	resultId: string;
	aggregateId: string;
	source: PaymentReconciliationSource;
	observationKey: string;
	outcome: PaymentReconciliationOutcome;
	expectedAmountFen?: number;
	observedAmountFen?: number;
	amountDeltaFen?: number;
	expectedStatus?: string;
	observedStatus?: string;
	resolution: PaymentReconciliationResolution;
	evidenceDigest: string;
	observedAt: string;
	createdAt: string;
};

export type PaymentSyncRepository = {
	findTaskById(taskId: string): Promise<PaymentSyncTask | undefined>;
	findTaskByKey(
		aggregateId: string,
		businessKey: string,
		source: PaymentSyncSource,
		kind: PaymentSyncKind,
	): Promise<PaymentSyncTask | undefined>;
	enqueueTask(task: PaymentSyncTask): Promise<PaymentSyncTask>;
	claimDueTasks(
		now: Date,
		limit: number,
		leaseMs: number,
	): Promise<readonly PaymentSyncTask[]>;
	/** 仅供 Admin 运营台读取，不返回 Provider 原文或凭证。 */
	listTasksForAdmin(
		query: PaymentSyncTaskListQuery,
	): Promise<readonly PaymentSyncTask[]>;
	updateTask(
		task: PaymentSyncTask,
		expectedVersion: number,
	): Promise<PaymentSyncTask>;
	appendReconciliation(
		result: PaymentReconciliationResult,
	): Promise<PaymentReconciliationResult>;
	listReconciliations(
		aggregateId: string,
	): Promise<readonly PaymentReconciliationResult[]>;
};

export function assertPaymentSyncIdentifier(
	value: unknown,
	label: string,
): string {
	if (!isBoundedOpaqueIdentifier(value)) throw new Error(`${label} is invalid`);
	return value;
}
