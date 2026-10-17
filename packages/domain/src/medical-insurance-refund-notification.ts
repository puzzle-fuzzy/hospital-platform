import { createHash } from "node:crypto";
import type {
	MedicalInsuranceOrder,
	MedicalInsuranceOrderRepository,
} from "./medical-insurance-order";
import { medicalInsurancePaymentBreakdown } from "./medical-insurance-order";
import type {
	MedicalInsuranceRefund,
	MedicalInsuranceRefundRepository,
} from "./medical-insurance-refund";
import { medicalInsuranceWechatCashRefundIdentity } from "./medical-insurance-refund-identity";
import type { PaymentSyncRepository, PaymentSyncTask } from "./payment-sync";
import type { AdapterCallContext } from "./ports";
import type { WechatRefundRepository } from "./wechat-refund";

export const MEDICAL_REFUND_NOTIFY_TASK_PREFIX = "medical_refund_notify:";
type NotificationInput = {
	mixTradeNo: string;
	totalFen: number;
	fundFen: number;
	personalAccountFen: number;
	otherFen: number;
	merchantRefundNo: string;
	successTime: string;
};
export type MedicalInsuranceRefundNotificationGateway = {
	notifyMedicalRefund(
		input: NotificationInput,
		context: AdapterCallContext,
	): Promise<{ requestId: string }>;
};

class NotificationFactsError extends Error {}

function taskId(refundNo: string): string {
	return `medrefundnotify-${createHash("sha256").update(refundNo).digest("hex").slice(0, 40)}`;
}

function fingerprint(input: NotificationInput): string {
	return createHash("sha256").update(JSON.stringify(input)).digest("base64url");
}

function taskFacts(task: PaymentSyncTask): {
	refundNo: string;
	successMillis: number;
	bodyFingerprint: string;
} {
	const suffix = task.businessKey.slice(
		MEDICAL_REFUND_NOTIFY_TASK_PREFIX.length,
	);
	const fingerprintSeparator = suffix.lastIndexOf(":");
	const timeSeparator = suffix.lastIndexOf(":", fingerprintSeparator - 1);
	const refundNo = suffix.slice(0, timeSeparator);
	const encodedTime = suffix.slice(timeSeparator + 1, fingerprintSeparator);
	const successMillis = Number.parseInt(encodedTime, 36);
	const bodyFingerprint = suffix.slice(fingerprintSeparator + 1);
	if (
		!task.businessKey.startsWith(MEDICAL_REFUND_NOTIFY_TASK_PREFIX) ||
		task.businessKey.length > 128 ||
		timeSeparator <= 0 ||
		task.taskId !== taskId(refundNo) ||
		!/^[0-9a-z]+$/.test(encodedTime) ||
		!Number.isSafeInteger(successMillis) ||
		successMillis <= 0 ||
		!Number.isFinite(Date.parse(task.createdAt)) ||
		successMillis > Date.parse(task.createdAt) ||
		!/^[A-Za-z0-9_-]{43}$/.test(bodyFingerprint) ||
		task.source !== "wechat_pay" ||
		task.kind !== "writeback"
	)
		throw new NotificationFactsError("invalid-medical-refund-notify-task");
	return { refundNo, successMillis, bodyFingerprint };
}

/** Durable result synchronization. Retrying a task can never call 6203 or refund cash. */
export class MedicalInsuranceRefundNotificationCoordinator {
	private readonly now: () => Date;
	constructor(
		private readonly dependencies: {
			tasks: PaymentSyncRepository;
			refunds: MedicalInsuranceRefundRepository;
			orders: MedicalInsuranceOrderRepository;
			wechatRefunds: WechatRefundRepository;
			gateway: MedicalInsuranceRefundNotificationGateway;
			resolveAggregateId(order: MedicalInsuranceOrder): Promise<string>;
			now?: () => Date;
		},
	) {
		this.now = dependencies.now ?? (() => new Date());
	}

	private async clearPendingMarker(refundNo: string): Promise<void> {
		const refund = await this.dependencies.refunds.findByRefundNo(refundNo);
		if (refund?.lastErrorCode !== "medical-refund-notify-pending") return;
		if (
			refund.medicalStatus !== "success" ||
			refund.medicalRefStatus !== "SUCC"
		)
			throw new NotificationFactsError("medical-refund-notify-facts-mismatch");
		const updated = await this.dependencies.refunds.update(
			{
				...refund,
				lastErrorCode: null,
				status:
					refund.cashFen === 0 || refund.wechatStatus === "success"
						? "succeeded"
						: refund.wechatStatus === "requested" ||
								refund.wechatStatus === "processing"
							? "processing"
							: "manual_review",
				version: refund.version + 1,
				updatedAt: this.now().toISOString(),
			},
			refund.version,
		);
		if (!updated) {
			const current = await this.dependencies.refunds.findByRefundNo(refundNo);
			if (current?.lastErrorCode === "medical-refund-notify-pending")
				throw new Error("medical-refund-notify-marker-changed");
		}
	}

	private async notificationInputs(
		order: MedicalInsuranceOrder,
		refund: MedicalInsuranceRefund,
		successMillis: number,
		createdAt: string,
	): Promise<readonly NotificationInput[]> {
		if (
			!order.amounts ||
			!order.orderType ||
			!order.wechatMixTradeNo ||
			refund.medicalOrderId !== order.medicalOrderId ||
			refund.medicalStatus !== "success" ||
			refund.medicalRefStatus !== "SUCC" ||
			refund.ownerUserId !== order.ownerUserId ||
			refund.payOrdId !== order.payOrdId ||
			refund.fundFen + refund.personalAccountFen <= 0 ||
			refund.fundFen > order.amounts.fundFen ||
			refund.personalAccountFen > order.amounts.personalAccountFen
		)
			throw new NotificationFactsError("medical-refund-notify-facts-mismatch");
		const settlement = await this.dependencies.orders.getSettlementContext(
			order.ownerUserId,
			order.medicalOrderId,
		);
		if (order.orderType === "RegPay" && !settlement?.insuredAreaCode)
			throw new NotificationFactsError(
				"medical-refund-payment-context-missing",
			);
		const breakdown = medicalInsurancePaymentBreakdown({
			amounts: order.amounts,
			orderType: order.orderType,
			insuredAreaCode: settlement?.insuredAreaCode ?? "",
		});
		let identities: readonly string[];
		if (breakdown.wechatCashFen <= 0)
			// WeChat accepts the full refund identity. The short HIS identifier is
			// retained only to match immutable notifications scheduled by older code.
			identities = [
				...new Set([refund.refundNo, refund.refundNo.slice(0, 40)]),
			];
		else {
			const cashRecords =
				(await this.dependencies.wechatRefunds.findBySourceAndSourceOrder?.(
					"medical_insurance",
					order.medicalOrderId,
				)) ?? [];
			const eligibleCash = [...cashRecords]
				.filter(
					(cash) =>
						cash.source === "medical_insurance" &&
						cash.sourceOrderId === order.medicalOrderId &&
						(!order.wechatOutTradeNo ||
							cash.outTradeNo === order.wechatOutTradeNo) &&
						Date.parse(cash.createdAt) <= Date.parse(createdAt),
				)
				.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
			identities = [
				...new Set(
					[
						refund.wechatMerchantRefundNo,
						...eligibleCash.map((cash) => cash.merchantRefundNo),
						medicalInsuranceWechatCashRefundIdentity(order.medicalOrderId)
							.merchantRefundNo,
						refund.refundNo,
					].filter((identity): identity is string => Boolean(identity)),
				),
			];
		}
		return identities.map((merchantRefundNo) => ({
			mixTradeNo: order.wechatMixTradeNo as string,
			totalFen: refund.fundFen + refund.personalAccountFen,
			fundFen: refund.fundFen,
			personalAccountFen: refund.personalAccountFen,
			otherFen: 0,
			merchantRefundNo,
			successTime: new Date(successMillis).toISOString(),
		}));
	}

	async schedule(
		order: MedicalInsuranceOrder,
		refund: MedicalInsuranceRefund,
	): Promise<PaymentSyncTask> {
		if (
			refund.medicalStatus !== "success" ||
			refund.medicalRefStatus !== "SUCC" ||
			refund.fundFen + refund.personalAccountFen <= 0 ||
			refund.medicalOrderId !== order.medicalOrderId ||
			refund.ownerUserId !== order.ownerUserId ||
			refund.payOrdId !== order.payOrdId
		)
			throw new NotificationFactsError("medical-refund-not-successful");
		const id = taskId(refund.refundNo);
		const existing = await this.dependencies.tasks.findTaskById(id);
		if (existing) {
			taskFacts(existing);
			if (existing.status === "succeeded")
				await this.clearPendingMarker(refund.refundNo);
			return existing;
		}
		const successTime = Date.parse(refund.updatedAt);
		if (
			!Number.isSafeInteger(successTime) ||
			successTime <= 0 ||
			successTime > this.now().getTime()
		)
			throw new NotificationFactsError("invalid-medical-refund-success-time");
		const now = this.now().toISOString();
		const [input] = await this.notificationInputs(
			order,
			refund,
			successTime,
			now,
		);
		if (!input)
			throw new NotificationFactsError(
				"medical-refund-notify-identity-missing",
			);
		// The compact timestamp leaves room for a complete SHA-256 fingerprint in VARCHAR(128).
		const businessKey = `${MEDICAL_REFUND_NOTIFY_TASK_PREFIX}${refund.refundNo}:${successTime.toString(36)}:${fingerprint(input)}`;
		if (businessKey.length > 128)
			throw new NotificationFactsError("medical-refund-notify-key-too-long");
		const task: PaymentSyncTask = {
			taskId: id,
			aggregateId: await this.dependencies.resolveAggregateId(order),
			businessKey,
			source: "wechat_pay",
			kind: "writeback",
			status: "pending",
			attempts: 0,
			maxAttempts: 20,
			nextRunAt: now,
			claimedUntil: null,
			lastErrorCode: null,
			resultDigest: null,
			version: 1,
			createdAt: now,
			updatedAt: now,
		};
		try {
			return await this.dependencies.tasks.enqueueTask(task);
		} catch (error) {
			const raced = await this.dependencies.tasks.findTaskById(id);
			if (raced) {
				taskFacts(raced);
				return raced;
			}
			throw error;
		}
	}

	async notify(
		order: MedicalInsuranceOrder,
		refund: MedicalInsuranceRefund,
	): Promise<void> {
		const task = await this.schedule(order, refund);
		if (task.status === "succeeded") return;
		const [claimed] = await this.dependencies.tasks.claimDueTasks(
			this.now(),
			1,
			120_000,
			{
				source: "wechat_pay",
				kind: "writeback",
				businessKeyPrefix: task.businessKey,
			},
		);
		if (!claimed || claimed.taskId !== task.taskId)
			throw new Error("medical-refund-notify-pending");
		await this.dispatch(claimed);
	}

	private async dispatch(task: PaymentSyncTask): Promise<void> {
		try {
			const { refundNo, successMillis, bodyFingerprint } = taskFacts(task);
			if (task.status !== "in_progress")
				throw new NotificationFactsError("invalid-medical-refund-notify-task");
			const refund = await this.dependencies.refunds.findByRefundNo(refundNo);
			const order = refund
				? await this.dependencies.orders.findByMedicalOrderId(
						refund.medicalOrderId,
					)
				: undefined;
			if (!refund || !order)
				throw new NotificationFactsError(
					"medical-refund-notify-facts-mismatch",
				);
			const candidates = await this.notificationInputs(
				order,
				refund,
				successMillis,
				task.createdAt,
			);
			const input = candidates.find(
				(candidate) => fingerprint(candidate) === bodyFingerprint,
			);
			if (!input)
				throw new NotificationFactsError(
					"medical-refund-notify-payload-changed",
				);
			const receipt = await this.dependencies.gateway.notifyMedicalRefund(
				input,
				{
					traceId: `med-refund-notify-${task.taskId.slice(-32)}-${task.attempts}`,
					idempotencyKey: input.merchantRefundNo,
				},
			);
			const saved = await this.dependencies.tasks.updateTask(
				{
					...task,
					status: "succeeded",
					attempts: task.attempts + 1,
					claimedUntil: null,
					lastErrorCode: null,
					resultDigest: createHash("sha256")
						.update(receipt.requestId)
						.digest("hex"),
					version: task.version + 1,
					updatedAt: this.now().toISOString(),
				},
				task.version,
			);
			if (saved?.status !== "succeeded")
				throw new Error("medical-refund-notify-task-changed");
			await this.clearPendingMarker(refundNo);
		} catch (error) {
			// An uncertain notification is safe to retry only with its immutable payload.
			const current = await this.dependencies.tasks.findTaskById(task.taskId);
			if (current?.status === "succeeded") throw error;
			if (
				!current ||
				current.version !== task.version ||
				current.status !== "in_progress"
			)
				throw error;
			const attempts = task.attempts + 1;
			await this.dependencies.tasks.updateTask(
				{
					...task,
					status:
						error instanceof NotificationFactsError ||
						attempts >= task.maxAttempts
							? "manual_review"
							: "pending",
					attempts,
					claimedUntil: null,
					nextRunAt: new Date(
						this.now().getTime() +
							Math.min(
								12 * 60 * 60_000,
								60_000 * 2 ** Math.min(attempts - 1, 10),
							),
					).toISOString(),
					lastErrorCode: "medical-refund-notify-pending",
					version: task.version + 1,
					updatedAt: this.now().toISOString(),
				},
				task.version,
			);
			throw error;
		}
	}

	async runOnce(): Promise<"idle" | "succeeded" | "retry_scheduled"> {
		let [task] = await this.dependencies.tasks.claimDueTasks(
			this.now(),
			1,
			120_000,
			{
				source: "wechat_pay",
				kind: "writeback",
				businessKeyPrefix: MEDICAL_REFUND_NOTIFY_TASK_PREFIX,
			},
		);
		if (!task) {
			// Recover a process exit between storing medical SUCC and scheduling sync.
			const candidates =
				(await this.dependencies.refunds.listAwaitingMedicalNotification?.(
					10,
				)) ?? [];
			for (const refund of candidates) {
				const order = await this.dependencies.orders.findByMedicalOrderId(
					refund.medicalOrderId,
				);
				if (order) {
					try {
						await this.schedule(order, refund);
					} catch (error) {
						if (!(error instanceof NotificationFactsError)) throw error;
					}
				}
			}
			[task] = await this.dependencies.tasks.claimDueTasks(
				this.now(),
				1,
				120_000,
				{
					source: "wechat_pay",
					kind: "writeback",
					businessKeyPrefix: MEDICAL_REFUND_NOTIFY_TASK_PREFIX,
				},
			);
		}
		if (!task) return "idle";
		try {
			await this.dispatch(task);
			return "succeeded";
		} catch {
			return "retry_scheduled";
		}
	}
}
