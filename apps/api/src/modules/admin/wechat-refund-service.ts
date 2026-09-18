import { ProviderRequestError } from "@hospital/adapters";
import {
	isBoundedOpaqueIdentifier,
	type AdapterCallContext,
	type MedicalInsuranceOrderRepository,
	type PaymentOrderRepository,
	type WechatRefund,
	WechatRefundAmountExceededError,
	type WechatRefundGateway,
	WechatRefundIdempotencyConflictError,
	WechatRefundNotFoundError,
	type WechatRefundProviderStatus,
	type WechatRefundRepository,
	type WechatRefundSource,
} from "@hospital/domain";

export type AdminWechatRefundInput = {
	source: WechatRefundSource;
	orderId: string;
	refundFen: number;
	idempotencyKey: string;
	reason?: string;
};

export class AdminWechatRefundInputError extends Error {
	constructor(message = "Admin Wechat refund input is invalid") {
		super(message);
		this.name = "AdminWechatRefundInputError";
	}
}

function requiredText(value: unknown, maxLength: number): string {
	if (typeof value !== "string") throw new AdminWechatRefundInputError();
	const normalized = value.trim();
	if (
		!normalized ||
		normalized.length > maxLength ||
		Array.from(normalized).some((character) => {
			const code = character.charCodeAt(0);
			return code <= 0x1f || code === 0x7f;
		})
	) {
		throw new AdminWechatRefundInputError();
	}
	return normalized;
}

function optionalReason(value: unknown): string | undefined {
	if (value === undefined || value === null || value === "") return undefined;
	const reason = requiredText(value, 80);
	if (new TextEncoder().encode(reason).byteLength > 80) {
		throw new AdminWechatRefundInputError("退款原因不能超过 80 字节");
	}
	return reason;
}

function providerStatusToLocal(
	status: WechatRefundProviderStatus,
): WechatRefund["status"] {
	return status === "SUCCESS"
		? "success"
		: status === "CLOSED"
			? "closed"
			: status === "ABNORMAL"
				? "abnormal"
				: "processing";
}

function refundIdentityMatches(
	record: WechatRefund,
	target: {
		source: WechatRefundSource;
		sourceOrderId: string;
		outTradeNo: string;
		totalFen: number;
	},
	refundFen: number,
): boolean {
	return (
		record.source === target.source &&
		record.sourceOrderId === target.sourceOrderId &&
		record.outTradeNo === target.outTradeNo &&
		record.totalFen === target.totalFen &&
		record.refundFen === refundFen
	);
}

function isUnknownProviderFailure(error: unknown): boolean {
	return (
		error instanceof ProviderRequestError && error.requestOutcome === "unknown"
	);
}

function errorCode(error: unknown): string {
	if (error instanceof ProviderRequestError) {
		return error.providerErrorCode ?? error.operation;
	}
	return error instanceof Error ? error.name : "UNKNOWN";
}

export class AdminWechatRefundService {
	private readonly now: () => Date;
	private readonly createId: () => string;

	constructor(
		private readonly dependencies: {
			refunds: WechatRefundRepository;
			paymentOrders: PaymentOrderRepository;
			medicalInsuranceOrders: MedicalInsuranceOrderRepository;
			gateway: WechatRefundGateway;
			now?: () => Date;
			createId?: () => string;
		},
	) {
		this.now = dependencies.now ?? (() => new Date());
		this.createId = dependencies.createId ?? (() => crypto.randomUUID());
	}

	private async resolveTarget(input: AdminWechatRefundInput) {
		const sourceOrderId = requiredText(input.orderId, 64);
		if (input.source === "payment_order") {
			const order =
				await this.dependencies.paymentOrders.findById(sourceOrderId);
			if (!order) throw new WechatRefundNotFoundError();
			if (
				order.state !== "cash_paid" &&
				order.state !== "his_written_back" &&
				order.state !== "completed"
			) {
				throw new AdminWechatRefundInputError(
					"普通微信订单尚未确认自费支付成功，不能发起退费",
				);
			}
			if (order.amounts.cashFen <= 0) {
				throw new AdminWechatRefundInputError("普通订单没有可退的微信自费金额");
			}
			return {
				source: input.source,
				sourceOrderId,
				outTradeNo: sourceOrderId,
				totalFen: order.amounts.cashFen,
			};
		}
		if (input.source !== "medical_insurance") {
			throw new AdminWechatRefundInputError();
		}
		const order =
			await this.dependencies.medicalInsuranceOrders.findByMedicalOrderId(
				sourceOrderId,
			);
		if (!order) throw new WechatRefundNotFoundError();
		if (order.wechatPaymentState !== "cash_paid" || !order.wechatOutTradeNo) {
			throw new AdminWechatRefundInputError(
				"医保混合单尚未确认微信自费支付成功，不能发起微信退费",
			);
		}
		const totalFen = order.amounts?.cashFen ?? 0;
		if (totalFen <= 0) {
			throw new AdminWechatRefundInputError("医保混合单没有可退的微信自费金额");
		}
		return {
			source: input.source,
			sourceOrderId,
			outTradeNo: order.wechatOutTradeNo,
			totalFen,
		};
	}

	private async applyProviderResult(
		record: WechatRefund,
		result: Awaited<ReturnType<WechatRefundGateway["requestRefund"]>>,
	): Promise<WechatRefund> {
		if (
			result.merchantRefundNo !== record.merchantRefundNo ||
			result.outTradeNo !== record.outTradeNo ||
			result.totalFen !== record.totalFen ||
			result.refundFen !== record.refundFen
		) {
			throw new Error("Wechat refund response did not match the refund record");
		}
		const now = this.now().toISOString();
		const updated: WechatRefund = {
			...record,
			status: providerStatusToLocal(result.status),
			providerStatus: result.status,
			providerRefundId: result.providerRefundId,
			providerTransactionId: result.providerTransactionId ?? null,
			providerRequestId: result.trace.requestId,
			successTime: result.successTime ?? null,
			lastErrorCode: null,
			version: record.version + 1,
			updatedAt: now,
		};
		const saved = await this.dependencies.refunds.update(
			updated,
			record.version,
		);
		if (!saved) throw new Error("Wechat refund record changed concurrently");
		return saved;
	}

	private async markRequestFailure(
		record: WechatRefund,
		error: unknown,
	): Promise<WechatRefund> {
		const updated: WechatRefund = {
			...record,
			status: isUnknownProviderFailure(error) ? "unknown" : "request_failed",
			lastErrorCode: errorCode(error),
			version: record.version + 1,
			updatedAt: this.now().toISOString(),
		};
		const saved = await this.dependencies.refunds.update(
			updated,
			record.version,
		);
		if (!saved) throw new Error("Wechat refund record changed concurrently");
		return saved;
	}

	async request(
		input: AdminWechatRefundInput,
		context: AdapterCallContext,
	): Promise<WechatRefund> {
		if (
			input.source !== "payment_order" &&
			input.source !== "medical_insurance"
		) {
			throw new AdminWechatRefundInputError();
		}
		const idempotencyKey = requiredText(input.idempotencyKey, 128);
		if (!isBoundedOpaqueIdentifier(idempotencyKey)) {
			throw new AdminWechatRefundInputError();
		}
		if (!Number.isSafeInteger(input.refundFen) || input.refundFen <= 0) {
			throw new AdminWechatRefundInputError("退费金额必须是正整数分");
		}
		const reason = optionalReason(input.reason);
		const target = await this.resolveTarget(input);
		if (input.refundFen > target.totalFen) {
			throw new WechatRefundAmountExceededError();
		}
		const now = this.now().toISOString();
		const merchantRefundNo = `RF-${target.source === "medical_insurance" ? "MI" : "PO"}-${this.createId().replaceAll("-", "").slice(0, 28)}`;
		const initial: WechatRefund = {
			refundRecordId: `refund-${this.createId()}`,
			merchantRefundNo,
			idempotencyKey,
			source: target.source,
			sourceOrderId: target.sourceOrderId,
			outTradeNo: target.outTradeNo,
			totalFen: target.totalFen,
			refundFen: input.refundFen,
			reason: reason ?? null,
			status: "requested",
			providerStatus: null,
			providerRefundId: null,
			providerTransactionId: null,
			providerRequestId: null,
			successTime: null,
			lastErrorCode: null,
			version: 1,
			createdAt: now,
			updatedAt: now,
		};
		const reserved = await this.dependencies.refunds.reserve(initial);
		const record = reserved.record;
		if (reserved.status === "existing") {
			if (!refundIdentityMatches(record, target, input.refundFen)) {
				throw new WechatRefundIdempotencyConflictError();
			}
			if (
				record.status === "success" ||
				record.status === "closed" ||
				record.status === "abnormal" ||
				record.status === "processing"
			) {
				return record;
			}
			if (record.status === "requested" || record.status === "unknown") {
				return this.query(record.merchantRefundNo, context);
			}
		}
		try {
			return await this.applyProviderResult(
				record,
				await this.dependencies.gateway.requestRefund(
					{
						outTradeNo: record.outTradeNo,
						merchantRefundNo: record.merchantRefundNo,
						totalFen: record.totalFen,
						refundFen: record.refundFen,
						...(record.reason ? { reason: record.reason } : {}),
					},
					context,
				),
			);
		} catch (error) {
			return this.markRequestFailure(record, error);
		}
	}

	async query(
		merchantRefundNo: string,
		context: AdapterCallContext,
	): Promise<WechatRefund> {
		const normalized = requiredText(merchantRefundNo, 64);
		const record =
			await this.dependencies.refunds.findByMerchantRefundNo(normalized);
		if (!record) throw new WechatRefundNotFoundError();
		const result = await this.dependencies.gateway.queryRefund(
			{ merchantRefundNo: record.merchantRefundNo },
			context,
		);
		return this.applyProviderResult(record, result);
	}
}
