import type { AdapterCallContext, ExternalTrace } from "./ports";
import type { WechatRefund } from "./wechat-refund";

export type MedicalInsuranceRefundType = "ALL" | "CASH" | "HI";

export type MedicalInsuranceRefundStatus =
	| "requested"
	| "processing"
	| "succeeded"
	| "failed"
	| "manual_review";

export type MedicalInsuranceRefundLegStatus =
	| "not_required"
	| "requested"
	| "processing"
	| "success"
	| "failed"
	| "unknown";

/**
 * 医保 + 微信 APIv3 的一次聚合退费记录。
 *
 * 这不是“微信医保混合支付”的 provider 订单模型，而是平台自己的
 * 编排记录：医保 6203 与微信 APIv3 普通退款各自有真实交易身份，平台只
 * 用 refundNo 将两条退费腿关联起来。
 */
export type MedicalInsuranceRefund = {
	refundId: string;
	medicalOrderId: string;
	ownerUserId: string;
	payOrdId: string;
	refundNo: string;
	idempotencyKey: string;
	refundType: MedicalInsuranceRefundType;
	totalFen: number;
	cashFen: number;
	personalAccountFen: number;
	fundFen: number;
	medicalStatus: MedicalInsuranceRefundLegStatus;
	medicalRefStatus: "SUCC" | "FAIL" | "EXP" | null;
	medicalProviderRequestId: string | null;
	wechatStatus: MedicalInsuranceRefundLegStatus;
	wechatMerchantRefundNo: string | null;
	status: MedicalInsuranceRefundStatus;
	lastErrorCode: string | null;
	version: number;
	createdAt: string;
	updatedAt: string;
};

export type MedicalInsuranceRefundRepository = {
	/** 源订单行锁下按原始医保分项累计预留；360221 等未消解失败不得另起身份重退。 */
	reserve(
		record: MedicalInsuranceRefund,
		originalAmounts?: {
			cashFen: number;
			personalAccountFen: number;
			fundFen: number;
		},
	): Promise<{
		status: "inserted" | "existing";
		record: MedicalInsuranceRefund;
	}>;
	findByRefundNo(refundNo: string): Promise<MedicalInsuranceRefund | undefined>;
	listByMedicalOrderId(
		medicalOrderId: string,
	): Promise<readonly MedicalInsuranceRefund[]>;
	listAwaitingMedicalNotification?(
		limit: number,
	): Promise<readonly MedicalInsuranceRefund[]>;
	findLatestByMedicalOrderId(
		medicalOrderId: string,
	): Promise<MedicalInsuranceRefund | undefined>;
	update(
		record: MedicalInsuranceRefund,
		expectedVersion: number,
	): Promise<MedicalInsuranceRefund | undefined>;
};

export class MedicalInsuranceRefundAmountExceededError extends Error {
	constructor() {
		super("医保退款分项已被其他退费占用或超过原支付金额");
		this.name = "MedicalInsuranceRefundAmountExceededError";
	}
}

/** 只有渠道明确 FAIL 才释放医保额度；成功、在途、未知及本地失败均继续占用。 */
export function medicalRefundReservesMedicalAmount(
	refund: MedicalInsuranceRefund,
): boolean {
	return (
		refund.medicalRefStatus !== "FAIL" &&
		(refund.personalAccountFen > 0 || refund.fundFen > 0)
	);
}

export type MedicalInsuranceRefundWechatProjection = Pick<
	MedicalInsuranceRefund,
	"wechatStatus" | "status" | "lastErrorCode"
>;

/**
 * 微信现金腿的状态只从本地微信退款台账投影，聚合服务和后台 Worker 共用。
 * unknown/processing 仍是可主动查单的非终态；CLOSED/ABNORMAL/明确申请失败
 * 会形成医保已退、现金未退的部分成功，必须进入人工复核。
 */
export function projectMedicalInsuranceWechatRefund(
	refund: WechatRefund,
): MedicalInsuranceRefundWechatProjection {
	if (refund.status === "success") {
		return {
			wechatStatus: "success",
			status: "succeeded",
			lastErrorCode: null,
		};
	}
	if (
		refund.status === "requested" ||
		refund.status === "processing" ||
		refund.status === "unknown"
	) {
		return {
			wechatStatus: refund.status === "unknown" ? "unknown" : "processing",
			status: "processing",
			lastErrorCode: refund.lastErrorCode,
		};
	}
	return {
		wechatStatus: "failed",
		status: "manual_review",
		lastErrorCode:
			refund.lastErrorCode ??
			(refund.status === "closed"
				? "wechat-refund-closed"
				: refund.status === "abnormal"
					? "wechat-refund-abnormal"
					: "wechat-refund-request-failed"),
	};
}

/** 6203 的窄端口；原始授权号只在构造 payload 的服务端调用栈内出现。 */
export type MedicalInsuranceRefundGateway = {
	refund(
		data: Record<string, unknown>,
		original: {
			totalFen: number;
			cashFen: number;
			personalAccountFen: number;
			fundFen: number;
		},
		context: AdapterCallContext,
	): Promise<{
		refStatus: "SUCC" | "FAIL" | "EXP";
		trace: ExternalTrace;
	}>;
};
