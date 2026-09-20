import type { AdapterCallContext } from "./ports";
import type { ExternalTrace } from "./ports";

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
	reserve(record: MedicalInsuranceRefund): Promise<{
		status: "inserted" | "existing";
		record: MedicalInsuranceRefund;
	}>;
	findByRefundNo(refundNo: string): Promise<MedicalInsuranceRefund | undefined>;
	findLatestByMedicalOrderId(
		medicalOrderId: string,
	): Promise<MedicalInsuranceRefund | undefined>;
	update(
		record: MedicalInsuranceRefund,
		expectedVersion: number,
	): Promise<MedicalInsuranceRefund | undefined>;
};

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
