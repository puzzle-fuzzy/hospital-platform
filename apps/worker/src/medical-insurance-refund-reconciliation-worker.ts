import { createHash } from "node:crypto";
import type {
	MedicalInsuranceRefund,
	MedicalInsuranceRefundRepository,
	PaymentSyncTask,
	WechatRefund,
	WechatRefundGateway,
	WechatRefundRepository,
} from "@hospital/domain";
import {
	type PaymentSyncCoordinator,
	projectMedicalInsuranceWechatRefund,
	projectWechatRefundProviderResult,
} from "@hospital/domain";
import {
	type AppLogger,
	createNoopLogger,
	providerFailureMetadata,
} from "@hospital/observability";

const REFUND_TASK_PREFIX = "medical_refund:";
const QUERY_BATCH_SIZE = 1;
const QUERY_CLAIM_LEASE_MS = 5 * 60_000;

export type MedicalInsuranceRefundReconciliationWorkerResult =
	| "idle"
	| "succeeded"
	| "retry_scheduled"
	| "manual_review";

/**
 * 官方建议前 5 分钟每分钟查一次，之后逐步衰减。长尾保持 12 小时一次，
 * 20 次任务覆盖约 5 天，不会因为银行卡退款延迟而高频请求微信。
 */
function nextQueryDelayMs(completedAttempts: number): number {
	if (completedAttempts <= 5) return 60_000;
	if (completedAttempts === 6) return 5 * 60_000;
	if (completedAttempts === 7) return 10 * 60_000;
	if (completedAttempts === 8) return 20 * 60_000;
	if (completedAttempts === 9) return 30 * 60_000;
	if (completedAttempts === 10) return 60 * 60_000;
	return 12 * 60 * 60_000;
}

function refundNoFromTask(task: PaymentSyncTask): string {
	if (
		task.source !== "wechat_pay" ||
		task.kind !== "reconcile" ||
		!task.businessKey.startsWith(REFUND_TASK_PREFIX)
	) {
		throw new Error("unsupported-medical-refund-sync-task");
	}
	const refundNo = task.businessKey.slice(REFUND_TASK_PREFIX.length);
	if (!refundNo || refundNo.length > 64) {
		throw new Error("invalid-medical-refund-sync-task");
	}
	return refundNo;
}

function errorCode(error: unknown): string {
	if (error && typeof error === "object") {
		const code = (error as { providerErrorCode?: unknown }).providerErrorCode;
		if (typeof code === "string" && code.trim())
			return code.trim().slice(0, 128);
	}
	if (error instanceof Error) {
		const message = error.message.trim();
		if (/^[A-Za-z0-9._:-]{1,128}$/.test(message)) return message;
		return error.name.slice(0, 128);
	}
	return "UNKNOWN";
}

function evidenceDigest(input: {
	medicalRefund: MedicalInsuranceRefund;
	wechatRefund: WechatRefund;
}): string {
	return createHash("sha256")
		.update(
			JSON.stringify({
				refundNo: input.medicalRefund.refundNo,
				medicalOrderId: input.medicalRefund.medicalOrderId,
				merchantRefundNo: input.wechatRefund.merchantRefundNo,
				providerStatus: input.wechatRefund.providerStatus,
				providerRefundId: input.wechatRefund.providerRefundId,
				refundFen: input.wechatRefund.refundFen,
			}),
			"utf8",
		)
		.digest("hex");
}

function hasTerminalWechatRefundFact(refund: WechatRefund): boolean {
	return (
		refund.status === "success" ||
		refund.status === "closed" ||
		refund.status === "abnormal" ||
		refund.status === "request_failed"
	);
}

/**
 * 医保聚合退费的微信现金腿主动查单 Worker。
 *
 * Worker 只查询已经持久化的同一 merchantRefundNo，不创建退款单，也不重放
 * 6203。微信台账和聚合台账均使用 CAS 更新；并发查询最多重复只读请求，不会
 * 产生第二笔资金操作。
 */
export class MedicalInsuranceRefundReconciliationWorker {
	private readonly logger: AppLogger;

	constructor(
		private readonly dependencies: {
			sync: PaymentSyncCoordinator;
			medicalRefunds: MedicalInsuranceRefundRepository;
			wechatRefunds: WechatRefundRepository;
			wechatRefund: WechatRefundGateway;
			logger?: AppLogger;
		},
	) {
		this.logger = dependencies.logger ?? createNoopLogger();
	}

	private async saveWechat(
		record: WechatRefund,
		result: Awaited<ReturnType<WechatRefundGateway["queryRefund"]>>,
		now: Date,
	): Promise<WechatRefund> {
		const projected = projectWechatRefundProviderResult(
			record,
			result,
			now.toISOString(),
		);
		const saved = await this.dependencies.wechatRefunds.update(
			projected,
			record.version,
		);
		if (saved) return saved;
		const current =
			await this.dependencies.wechatRefunds.findByMerchantRefundNo(
				record.merchantRefundNo,
			);
		if (current) return current;
		throw new Error("wechat-refund-version-conflict");
	}

	private async saveAggregate(
		record: MedicalInsuranceRefund,
		wechatRefund: WechatRefund,
		now: Date,
	): Promise<MedicalInsuranceRefund> {
		const projected = projectMedicalInsuranceWechatRefund(wechatRefund);
		const saved = await this.dependencies.medicalRefunds.update(
			{
				...record,
				...projected,
				wechatMerchantRefundNo: wechatRefund.merchantRefundNo,
				version: record.version + 1,
				updatedAt: now.toISOString(),
			},
			record.version,
		);
		if (saved) return saved;
		const current = await this.dependencies.medicalRefunds.findByRefundNo(
			record.refundNo,
		);
		if (current) return current;
		throw new Error("medical-refund-version-conflict");
	}

	private async markAggregateManualReview(
		record: MedicalInsuranceRefund,
		now: Date,
		reason: string,
	): Promise<void> {
		let current = record;
		for (let attempt = 0; attempt < 3; attempt += 1) {
			if (current.status === "succeeded" || current.status === "manual_review")
				return;
			const saved = await this.dependencies.medicalRefunds.update(
				{
					...current,
					status: "manual_review",
					lastErrorCode: reason,
					version: current.version + 1,
					updatedAt: now.toISOString(),
				},
				current.version,
			);
			if (saved) return;
			const reloaded = await this.dependencies.medicalRefunds.findByRefundNo(
				current.refundNo,
			);
			if (!reloaded) return;
			current = reloaded;
		}
		this.logger.warn(
			{
				event: "worker.medical_refund.manual_review_conflict",
				refundNo: current.refundNo,
				medicalOrderId: current.medicalOrderId,
				reason,
			},
			"Medical insurance refund aggregate could not enter manual review",
		);
	}

	private async manualReview(
		task: PaymentSyncTask,
		now: Date,
		reasonCode: string,
		medicalRefund?: MedicalInsuranceRefund,
	): Promise<MedicalInsuranceRefundReconciliationWorkerResult> {
		if (medicalRefund) {
			await this.markAggregateManualReview(medicalRefund, now, reasonCode);
		}
		await this.dependencies.sync.markManualReview({ task, reasonCode });
		return "manual_review";
	}

	private async retry(
		task: PaymentSyncTask,
		now: Date,
		reasonCode: string,
		medicalRefund?: MedicalInsuranceRefund,
	): Promise<MedicalInsuranceRefundReconciliationWorkerResult> {
		const completedAttempts = task.attempts + 1;
		const updated = await this.dependencies.sync.markFailure({
			task,
			reasonCode,
			nextRunAt: new Date(
				now.getTime() + nextQueryDelayMs(completedAttempts),
			).toISOString(),
		});
		if (updated.status !== "manual_review") return "retry_scheduled";
		if (medicalRefund) {
			await this.markAggregateManualReview(
				medicalRefund,
				now,
				"wechat-refund-query-exhausted",
			);
		}
		return "manual_review";
	}

	async runOnce(
		now = new Date(),
	): Promise<MedicalInsuranceRefundReconciliationWorkerResult> {
		const [task] = await this.dependencies.sync.claimDue(
			now,
			QUERY_BATCH_SIZE,
			QUERY_CLAIM_LEASE_MS,
			{
				source: "wechat_pay",
				kind: "reconcile",
				businessKeyPrefix: REFUND_TASK_PREFIX,
			},
		);
		if (!task) return "idle";

		let medicalRefund: MedicalInsuranceRefund | undefined;
		try {
			let refundNo: string;
			try {
				refundNo = refundNoFromTask(task);
			} catch (error) {
				return this.manualReview(task, now, errorCode(error));
			}
			medicalRefund =
				await this.dependencies.medicalRefunds.findByRefundNo(refundNo);
			if (
				medicalRefund?.medicalStatus !== "success" ||
				medicalRefund.cashFen <= 0
			) {
				return this.manualReview(
					task,
					now,
					"medical-refund-not-reconcilable",
					medicalRefund,
				);
			}
			const merchantRefundNo =
				medicalRefund.wechatMerchantRefundNo ?? medicalRefund.refundNo;
			const wechatRecord =
				await this.dependencies.wechatRefunds.findByMerchantRefundNo(
					merchantRefundNo,
				);
			if (
				wechatRecord?.source !== "medical_insurance" ||
				wechatRecord.sourceOrderId !== medicalRefund.medicalOrderId ||
				wechatRecord.refundFen !== medicalRefund.cashFen
			) {
				return this.manualReview(
					task,
					now,
					"wechat-refund-aggregate-mismatch",
					medicalRefund,
				);
			}
			let savedWechat = wechatRecord;
			if (!hasTerminalWechatRefundFact(wechatRecord)) {
				const attempt = task.attempts + 1;
				const traceId = `refund-sync-${createHash("sha256")
					.update(`${task.taskId}:${attempt}`, "utf8")
					.digest("hex")
					.slice(0, 32)}`;
				const providerResult = await this.dependencies.wechatRefund.queryRefund(
					{ merchantRefundNo },
					{
						traceId,
						idempotencyKey: `refund-query:${refundNo}`,
					},
				);
				savedWechat = await this.saveWechat(wechatRecord, providerResult, now);
			}
			const savedAggregate = await this.saveAggregate(
				medicalRefund,
				savedWechat,
				now,
			);
			if (savedAggregate.status === "processing") {
				return this.retry(
					task,
					now,
					"wechat-refund-processing",
					savedAggregate,
				);
			}
			await this.dependencies.sync.recordObservation({
				task,
				expectedAmountFen: medicalRefund.cashFen,
				expectedStatus: "SUCCESS",
				observation: {
					observationKey: `wechat-refund:${refundNo}:${savedWechat.providerStatus ?? savedWechat.status}`,
					observed: true,
					observedAmountFen: savedWechat.refundFen,
					observedStatus: savedWechat.providerStatus ?? savedWechat.status,
					evidenceDigest: evidenceDigest({
						medicalRefund: savedAggregate,
						wechatRefund: savedWechat,
					}),
					observedAt: now.toISOString(),
				},
			});
			this.logger.info(
				{
					event: "worker.medical_refund.wechat_reconciled",
					refundNo,
					medicalOrderId: medicalRefund.medicalOrderId,
					providerStatus: savedWechat.providerStatus,
					status: savedAggregate.status,
				},
				"Medical insurance refund Wechat leg reconciled",
			);
			return savedAggregate.status === "succeeded"
				? "succeeded"
				: "manual_review";
		} catch (error) {
			this.logger.warn(
				{
					event: "worker.medical_refund.wechat_query_failed",
					taskId: task.taskId,
					...(medicalRefund
						? {
								refundNo: medicalRefund.refundNo,
								medicalOrderId: medicalRefund.medicalOrderId,
							}
						: {}),
					...providerFailureMetadata(error),
				},
				"Medical insurance refund Wechat query will be retried",
			);
			return this.retry(task, now, errorCode(error), medicalRefund);
		}
	}
}

export { nextQueryDelayMs as medicalInsuranceRefundQueryDelayMs };
