import { ProviderRequestError } from "@hospital/adapters";
import {
	type AdapterCallContext,
	isBoundedOpaqueIdentifier,
	type MedicalInsuranceOrder,
	type MedicalInsuranceOrderRepository,
	type PaymentOrder,
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

export type AdminWechatRefundHistoryQuery = {
	source?: WechatRefundSource;
	/** 精确匹配服务端订单号；为空时读取最近记录。 */
	orderId?: string;
	limit?: number;
};

/**
 * Admin 退款页面仅使用此最小支付读模型。患者、支付凭证、微信调起参数、
 * out_trade_no 和加密 Provider 上下文一律不离开服务端。
 */
export type AdminWechatRefundPaymentRecord = {
	source: WechatRefundSource;
	orderId: string;
	business: "registration" | "outpatient" | "other";
	/** 普通自费为本地订单状态；医保混合单为微信现金段状态。 */
	paymentState: string;
	cashPaymentConfirmed: boolean;
	cashFen: number;
	refundReservedFen: number;
	refundableFen: number;
	refundCount: number;
	latestRefund?: {
		merchantRefundNo: string;
		status: WechatRefund["status"];
		refundFen: number;
		updatedAt: string;
	};
	/** Admin 直退、挂号退款编排或当前不可退。 */
	refundRoute: "admin" | "appointment_cancel" | "unavailable";
	createdAt: string;
	updatedAt: string;
};

/**
 * 仅限服务端编排调用：outTradeNo 必须来自已加密保存的 Provider 支付上下文，
 * 不能由管理端或小程序请求覆盖。
 */
export type TrustedPaymentOrderRefundInput = Omit<
	AdminWechatRefundInput,
	"source"
> & {
	outTradeNo: string;
};

type NormalizedRefundInput = {
	source: WechatRefundSource;
	orderId: string;
	refundFen: number;
	idempotencyKey: string;
	reason?: string;
};

type ResolvedRefundTarget = {
	source: WechatRefundSource;
	sourceOrderId: string;
	outTradeNo: string;
	totalFen: number;
};

export class AdminWechatRefundInputError extends Error {
	constructor(message = "Admin Wechat refund input is invalid") {
		super(message);
		this.name = "AdminWechatRefundInputError";
	}
}

export class AdminWechatRefundHistoryNotConfiguredError extends Error {
	constructor() {
		super("Admin Wechat refund payment history is not configured");
		this.name = "AdminWechatRefundHistoryNotConfiguredError";
	}
}

const CONFIRMED_PAYMENT_ORDER_STATES = new Set([
	"cash_paid",
	"his_written_back",
	"completed",
]);
const RESERVED_REFUND_STATUSES = new Set<WechatRefund["status"]>([
	"requested",
	"processing",
	"success",
	"unknown",
]);
const REGISTRATION_SELF_PAY_KEY_PREFIX = "registration-self-pay:";
const OUTPATIENT_SELF_PAY_KEY_PREFIX = "outpatient-self-pay:";

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

function normalizeRefundInput(
	input: AdminWechatRefundInput,
): NormalizedRefundInput {
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
	return {
		source: input.source,
		orderId: requiredText(input.orderId, 64),
		refundFen: input.refundFen,
		idempotencyKey,
		...(reason ? { reason } : {}),
	};
}

function normalizeHistoryQuery(
	input: AdminWechatRefundHistoryQuery,
): Required<Pick<AdminWechatRefundHistoryQuery, "limit">> &
	Pick<AdminWechatRefundHistoryQuery, "source" | "orderId"> {
	if (
		input.source !== undefined &&
		input.source !== "payment_order" &&
		input.source !== "medical_insurance"
	) {
		throw new AdminWechatRefundInputError();
	}
	const limit = input.limit ?? 50;
	if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100) {
		throw new AdminWechatRefundInputError("历史支付查询条数不合法");
	}
	const orderId = input.orderId?.trim();
	return {
		limit,
		...(input.source ? { source: input.source } : {}),
		...(orderId ? { orderId: requiredText(orderId, 64) } : {}),
	};
}

function normalPaymentBusiness(
	order: PaymentOrder,
): AdminWechatRefundPaymentRecord["business"] {
	if (order.idempotencyKey.startsWith(REGISTRATION_SELF_PAY_KEY_PREFIX)) {
		return "registration";
	}
	if (order.idempotencyKey.startsWith(OUTPATIENT_SELF_PAY_KEY_PREFIX)) {
		return "outpatient";
	}
	return "other";
}

function medicalPaymentBusiness(
	order: MedicalInsuranceOrder,
): AdminWechatRefundPaymentRecord["business"] {
	return order.businessType === "outpatient" || order.orderType === "DiagPay"
		? "outpatient"
		: "registration";
}

function refundSummary(refunds: readonly WechatRefund[]): {
	reservedFen: number;
	latestRefund: AdminWechatRefundPaymentRecord["latestRefund"];
} {
	const ordered = [...refunds].sort((left, right) => {
		const updated = right.updatedAt.localeCompare(left.updatedAt);
		return updated || right.refundRecordId.localeCompare(left.refundRecordId);
	});
	const latest = ordered[0];
	return {
		reservedFen: ordered
			.filter((refund) => RESERVED_REFUND_STATUSES.has(refund.status))
			.reduce((total, refund) => total + refund.refundFen, 0),
		latestRefund: latest
			? {
					merchantRefundNo: latest.merchantRefundNo,
					status: latest.status,
					refundFen: latest.refundFen,
					updatedAt: latest.updatedAt,
				}
			: undefined,
	};
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

	private async resolveTarget(
		input: NormalizedRefundInput,
		trustedPaymentOrderOutTradeNo?: string,
	): Promise<ResolvedRefundTarget> {
		const sourceOrderId = input.orderId;
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
			if (
				!trustedPaymentOrderOutTradeNo &&
				order.idempotencyKey.startsWith(REGISTRATION_SELF_PAY_KEY_PREFIX)
			) {
				throw new AdminWechatRefundInputError(
					"挂号自费退款必须从预约取消流程发起，不能绕过医院退款回写",
				);
			}
			return {
				source: input.source,
				sourceOrderId,
				outTradeNo: trustedPaymentOrderOutTradeNo ?? sourceOrderId,
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

	private async requestForTarget(
		input: NormalizedRefundInput,
		target: ResolvedRefundTarget,
		context: AdapterCallContext,
	): Promise<WechatRefund> {
		if (input.refundFen > target.totalFen) {
			throw new WechatRefundAmountExceededError();
		}
		const now = this.now().toISOString();
		const merchantRefundNo = `RF-${target.source === "medical_insurance" ? "MI" : "PO"}-${this.createId().replaceAll("-", "").slice(0, 28)}`;
		const initial: WechatRefund = {
			refundRecordId: `refund-${this.createId()}`,
			merchantRefundNo,
			idempotencyKey: input.idempotencyKey,
			source: target.source,
			sourceOrderId: target.sourceOrderId,
			outTradeNo: target.outTradeNo,
			totalFen: target.totalFen,
			refundFen: input.refundFen,
			reason: input.reason ?? null,
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

	async request(
		input: AdminWechatRefundInput,
		context: AdapterCallContext,
	): Promise<WechatRefund> {
		const normalized = normalizeRefundInput(input);
		return this.requestForTarget(
			normalized,
			await this.resolveTarget(normalized),
			context,
		);
	}

	async listPaymentHistory(
		input: AdminWechatRefundHistoryQuery = {},
	): Promise<readonly AdminWechatRefundPaymentRecord[]> {
		const query = normalizeHistoryQuery(input);
		const listPaymentOrders =
			this.dependencies.paymentOrders.listRecentForAdmin;
		const listMedicalOrders =
			this.dependencies.medicalInsuranceOrders.listRecentForAdmin;
		const findRefunds = this.dependencies.refunds.findBySourceAndSourceOrder;
		if (!listPaymentOrders || !listMedicalOrders || !findRefunds) {
			throw new AdminWechatRefundHistoryNotConfiguredError();
		}
		const [paymentOrders, medicalOrders] = await Promise.all([
			query.source === "medical_insurance"
				? Promise.resolve([] as readonly PaymentOrder[])
				: listPaymentOrders({
						limit: query.limit,
						...(query.orderId ? { orderId: query.orderId } : {}),
					}),
			query.source === "payment_order"
				? Promise.resolve([] as readonly MedicalInsuranceOrder[])
				: listMedicalOrders({
						limit: query.limit,
						...(query.orderId ? { orderId: query.orderId } : {}),
					}),
		]);
		const candidates = [
			...paymentOrders.map((order) => ({
				source: "payment_order" as const,
				order,
			})),
			...medicalOrders.map((order) => ({
				source: "medical_insurance" as const,
				order,
			})),
		].sort((left, right) => {
			const updated = right.order.updatedAt.localeCompare(left.order.updatedAt);
			const leftId =
				left.source === "payment_order"
					? left.order.orderId
					: left.order.medicalOrderId;
			const rightId =
				right.source === "payment_order"
					? right.order.orderId
					: right.order.medicalOrderId;
			return updated || rightId.localeCompare(leftId);
		});
		const records = await Promise.all(
			candidates.slice(0, query.limit).map(async (candidate) => {
				const orderId =
					candidate.source === "payment_order"
						? candidate.order.orderId
						: candidate.order.medicalOrderId;
				const refunds = await findRefunds(candidate.source, orderId);
				const summary = refundSummary(refunds);
				if (candidate.source === "payment_order") {
					const order = candidate.order;
					const cashPaymentConfirmed = CONFIRMED_PAYMENT_ORDER_STATES.has(
						order.state,
					);
					const refundableFen = cashPaymentConfirmed
						? Math.max(0, order.amounts.cashFen - summary.reservedFen)
						: 0;
					const business = normalPaymentBusiness(order);
					return {
						source: candidate.source,
						orderId,
						business,
						paymentState: order.state,
						cashPaymentConfirmed,
						cashFen: order.amounts.cashFen,
						refundReservedFen: summary.reservedFen,
						refundableFen,
						refundCount: refunds.length,
						...(summary.latestRefund
							? { latestRefund: summary.latestRefund }
							: {}),
						refundRoute:
							!cashPaymentConfirmed || refundableFen <= 0
								? "unavailable"
								: business === "registration"
									? "appointment_cancel"
									: "admin",
						createdAt: order.createdAt,
						updatedAt: order.updatedAt,
					} satisfies AdminWechatRefundPaymentRecord;
				}
				const order = candidate.order;
				const cashPaymentConfirmed = order.wechatPaymentState === "cash_paid";
				const cashFen = order.amounts?.cashFen ?? 0;
				const refundableFen = cashPaymentConfirmed
					? Math.max(0, cashFen - summary.reservedFen)
					: 0;
				return {
					source: candidate.source,
					orderId,
					business: medicalPaymentBusiness(order),
					paymentState: order.wechatPaymentState ?? "not_started",
					cashPaymentConfirmed,
					cashFen,
					refundReservedFen: summary.reservedFen,
					refundableFen,
					refundCount: refunds.length,
					...(summary.latestRefund
						? { latestRefund: summary.latestRefund }
						: {}),
					refundRoute:
						cashPaymentConfirmed && refundableFen > 0 ? "admin" : "unavailable",
					createdAt: order.createdAt,
					updatedAt: order.updatedAt,
				} satisfies AdminWechatRefundPaymentRecord;
			}),
		);
		return records;
	}

	/**
	 * 当前挂号 MD5 支付的微信 out_trade_no 由众阳 .2 返回。它不等于本地
	 * payment order id 时，只有这个服务端入口可以使用已保存的真实值。
	 */
	async requestTrustedPaymentOrder(
		input: TrustedPaymentOrderRefundInput,
		context: AdapterCallContext,
	): Promise<WechatRefund> {
		const normalized = normalizeRefundInput({
			source: "payment_order",
			orderId: input.orderId,
			refundFen: input.refundFen,
			idempotencyKey: input.idempotencyKey,
			...(input.reason !== undefined ? { reason: input.reason } : {}),
		});
		const outTradeNo = requiredText(input.outTradeNo, 32);
		return this.requestForTarget(
			normalized,
			await this.resolveTarget(normalized, outTradeNo),
			context,
		);
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
