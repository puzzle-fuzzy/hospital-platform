import { createHash } from "node:crypto";
import type {
	PaymentOperatorAuditRepository,
	PaymentSyncKind,
	PaymentSyncRepository,
	PaymentSyncSource,
	PaymentSyncTask,
	PaymentSyncTaskListQuery,
	PaymentSyncTaskStatus,
} from "@hospital/domain";

export type PaymentSyncAdminListInput = Omit<
	PaymentSyncTaskListQuery,
	"limit"
> & {
	limit?: number;
};

export type PaymentSyncAdminActionContext = {
	requestId?: string;
	operatorRef?: string;
};

export class PaymentSyncAdminTaskNotFoundError extends Error {
	constructor() {
		super("Payment sync task was not found");
		this.name = "PaymentSyncAdminTaskNotFoundError";
	}
}

export class PaymentSyncAdminTaskConflictError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "PaymentSyncAdminTaskConflictError";
	}
}

export class PaymentSyncAdminInputError extends Error {
	constructor(message = "Payment sync admin input is invalid") {
		super(message);
		this.name = "PaymentSyncAdminInputError";
	}
}

type Dependencies = {
	repository: PaymentSyncRepository;
	operatorAudits: PaymentOperatorAuditRepository;
	now?: () => Date;
};

function boundedLimit(value: number | undefined): number {
	const limit = value ?? 50;
	if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100) {
		throw new PaymentSyncAdminInputError("同步任务条数必须是 1 到 100 的整数");
	}
	return limit;
}

function boundedTaskId(value: string): string {
	if (
		!value ||
		value.length > 64 ||
		value !== value.trim() ||
		Array.from(value).some((character) => character.charCodeAt(0) <= 0x1f)
	) {
		throw new PaymentSyncAdminInputError("同步任务号不合法");
	}
	return value;
}

function boundedReason(value: string): string {
	const reason = value.trim();
	if (
		!reason ||
		reason.length > 64 ||
		Array.from(reason).some((character) => {
			const code = character.charCodeAt(0);
			return code <= 0x1f || code === 0x7f;
		})
	) {
		throw new PaymentSyncAdminInputError("人工复核原因必须是 1 到 64 个字符");
	}
	return reason;
}

function auditId(
	action: string,
	task: PaymentSyncTask,
	nextVersion: number,
): string {
	const digest = createHash("sha256")
		.update(`${action}:${task.taskId}:${nextVersion}`, "utf8")
		.digest("hex");
	return `audit-${digest.slice(0, 58)}`;
}

/**
 * Admin 只操作同步任务，不直接改支付聚合单、支付腿或来源订单终态。
 * 重试会把一次已失败/人工复核的执行周期重新置为 pending，并保留审计事实。
 */
export class PaymentSyncAdminService {
	private readonly now: () => Date;

	constructor(private readonly dependencies: Dependencies) {
		this.now = dependencies.now ?? (() => new Date());
	}

	list(
		input: PaymentSyncAdminListInput = {},
	): Promise<readonly PaymentSyncTask[]> {
		return this.dependencies.repository.listTasksForAdmin({
			limit: boundedLimit(input.limit),
			...(input.status ? { status: input.status } : {}),
			...(input.source ? { source: input.source } : {}),
			...(input.kind ? { kind: input.kind } : {}),
			...(input.aggregateId ? { aggregateId: input.aggregateId } : {}),
		});
	}

	async retry(
		taskId: string,
		context: PaymentSyncAdminActionContext = {},
	): Promise<PaymentSyncTask> {
		const task = await this.find(taskId);
		if (task.status === "pending" || task.status === "in_progress") {
			throw new PaymentSyncAdminTaskConflictError(
				"同步任务当前正在等待或执行中",
			);
		}
		if (task.status === "succeeded") {
			throw new PaymentSyncAdminTaskConflictError("已成功的同步任务不能重试");
		}
		const now = this.now().toISOString();
		const updated = await this.dependencies.repository.updateTask(
			{
				...task,
				status: "pending",
				// 人工重试开启新的执行周期，不抹掉审计表中的历史动作。
				attempts: 0,
				claimedUntil: null,
				nextRunAt: now,
				lastErrorCode: null,
				resultDigest: null,
				version: task.version + 1,
				updatedAt: now,
			},
			task.version,
		);
		await this.audit(updated, "sync_retry", context, "admin_retry");
		return updated;
	}

	async markManualReview(
		taskId: string,
		reason: string,
		context: PaymentSyncAdminActionContext = {},
	): Promise<PaymentSyncTask> {
		const task = await this.find(taskId);
		const reasonCode = boundedReason(reason);
		if (task.status === "manual_review") return task;
		if (task.status === "in_progress") {
			throw new PaymentSyncAdminTaskConflictError(
				"同步任务当前已被 Worker 占用",
			);
		}
		if (task.status === "succeeded") {
			throw new PaymentSyncAdminTaskConflictError(
				"已成功的同步任务不能转人工复核",
			);
		}
		const now = this.now().toISOString();
		const updated = await this.dependencies.repository.updateTask(
			{
				...task,
				status: "manual_review",
				claimedUntil: null,
				nextRunAt: now,
				lastErrorCode: reasonCode,
				version: task.version + 1,
				updatedAt: now,
			},
			task.version,
		);
		await this.audit(updated, "manual_review", context, reasonCode);
		return updated;
	}

	private async find(taskId: string): Promise<PaymentSyncTask> {
		const task = await this.dependencies.repository.findTaskById(
			boundedTaskId(taskId),
		);
		if (!task) throw new PaymentSyncAdminTaskNotFoundError();
		return task;
	}

	private audit(
		task: PaymentSyncTask,
		action: "sync_retry" | "manual_review",
		context: PaymentSyncAdminActionContext,
		reasonCode: string,
	): Promise<unknown> {
		return this.dependencies.operatorAudits.append({
			auditId: auditId(action, task, task.version),
			operatorRef: context.operatorRef ?? null,
			action,
			aggregateId: task.aggregateId,
			...(context.requestId ? { requestId: context.requestId } : {}),
			outcome: "succeeded",
			reasonCode,
			occurredAt: task.updatedAt,
		});
	}
}

export type { PaymentSyncKind, PaymentSyncSource, PaymentSyncTaskStatus };
