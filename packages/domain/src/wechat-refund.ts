import type { ExternalTrace, AdapterCallContext } from "./ports";

export type WechatRefundSource = "payment_order" | "medical_insurance";

/** 微信退款 API 返回的退款状态；未知值不能进入业务终态。 */
export type WechatRefundProviderStatus =
	| "SUCCESS"
	| "CLOSED"
	| "PROCESSING"
	| "ABNORMAL";

/** 本地退款台账状态；unknown 表示请求结果不确定，必须先查同一退款单号。 */
export type WechatRefundStatus =
	| "requested"
	| "processing"
	| "success"
	| "closed"
	| "abnormal"
	| "unknown"
	| "request_failed";

export type WechatRefund = {
	refundRecordId: string;
	merchantRefundNo: string;
	source: WechatRefundSource;
	sourceOrderId: string;
	outTradeNo: string;
	totalFen: number;
	refundFen: number;
	reason: string | null;
	idempotencyKey: string;
	status: WechatRefundStatus;
	providerStatus: WechatRefundProviderStatus | null;
	providerRefundId: string | null;
	providerTransactionId: string | null;
	providerRequestId: string | null;
	successTime: string | null;
	lastErrorCode: string | null;
	version: number;
	createdAt: string;
	updatedAt: string;
};

export type WechatRefundRepository = {
	/** 原子预留退款额度；并发退款不能超过同一支付订单的可退金额。 */
	reserve(
		record: WechatRefund,
	): Promise<{ status: "inserted" | "existing"; record: WechatRefund }>;
	findByMerchantRefundNo(
		merchantRefundNo: string,
	): Promise<WechatRefund | undefined>;
	update(
		record: WechatRefund,
		expectedVersion: number,
	): Promise<WechatRefund | undefined>;
};

export class WechatRefundIdempotencyConflictError extends Error {
	constructor() {
		super("Wechat refund idempotency key conflicts with an existing refund");
		this.name = "WechatRefundIdempotencyConflictError";
	}
}

export class WechatRefundAmountExceededError extends Error {
	constructor() {
		super("Wechat refund amount exceeds the paid amount");
		this.name = "WechatRefundAmountExceededError";
	}
}

export class WechatRefundNotFoundError extends Error {
	constructor() {
		super("Wechat refund record was not found");
		this.name = "WechatRefundNotFoundError";
	}
}

/** 普通商户 APIv3 退款申请/查单的最小适配器契约。 */
export interface WechatRefundGateway {
	requestRefund(
		input: {
			outTradeNo: string;
			merchantRefundNo: string;
			totalFen: number;
			refundFen: number;
			reason?: string;
		},
		context: AdapterCallContext,
	): Promise<WechatRefundProviderResult>;
	queryRefund(
		input: { merchantRefundNo: string },
		context: AdapterCallContext,
	): Promise<WechatRefundProviderResult>;
}

export type WechatRefundProviderResult = {
	status: WechatRefundProviderStatus;
	merchantRefundNo: string;
	providerRefundId: string;
	providerTransactionId?: string;
	outTradeNo: string;
	totalFen: number;
	refundFen: number;
	successTime?: string;
	trace: ExternalTrace;
};
