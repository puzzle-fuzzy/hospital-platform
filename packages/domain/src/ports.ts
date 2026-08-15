import type { PaymentState } from "@hospital/contracts";
import type { PaymentAmounts } from "./payment-order";

/** 每次 provider 调用都必须携带的链路和幂等上下文。 */
export type AdapterCallContext = {
	traceId: string;
	idempotencyKey: string;
	signal?: AbortSignal;
	timeoutMs?: number;
};

/** 外部系统证据索引；只保存可关联的标识，不保存密钥或完整敏感报文。 */
export type ExternalTrace = {
	provider: string;
	operation: string;
	requestId: string;
	providerOrderId?: string;
};

/** 微信查单 adapter 只允许返回三种可编排状态，其他 provider 状态必须 fail-closed。 */
export type WechatPaymentQueryState = "cash_pending" | "cash_paid" | "failed";

/**
 * 医保 provider 的结算状态只能映射到医保阶段，不能直接宣称微信已支付或 HIS 已回写。
 * 无法确认的 provider 状态必须由 adapter 映射为 awaiting_confirmation。
 */
export type MedicalInsuranceSettlementState =
	| "insurance_settled"
	| "cash_pending"
	| "awaiting_confirmation"
	| "failed";

/**
 * 6202/6301 的金额证据必须和状态一起返回；query 不能只返回一个 success-like 状态。
 * 金额沿用订单的整数分模型，避免医保 adapter 重新定义元/分单位。
 */
export type MedicalInsuranceSettlementEvidence = {
	state: MedicalInsuranceSettlementState;
	amounts: PaymentAmounts;
	trace: ExternalTrace;
};

/** 支付订单的内部快照，金额统一使用整数分。 */
export type PaymentOrderSnapshot = {
	orderId: string;
	state: PaymentState;
	totalFen: number;
	insuranceFen: number;
	cashFen: number;
	trace: ExternalTrace[];
};

/**
 * 微信小程序调起支付所需的服务端签名结果。
 *
 * 这些字段只允许从后端 adapter 返回给受控的 API response；小程序不应
 * 自己生成 paySign，也不应接触商户私钥、APIv3 密钥或平台证书。
 */
export type WechatMiniProgramPayParams = {
	appId: string;
	timeStamp: string;
	nonceStr: string;
	package: string;
	signType: "RSA";
	paySign: string;
};

export interface MedicalInsuranceGateway {
	authorize(
		input: {
			authCode: string;
			patientId: string;
		},
		context: AdapterCallContext,
	): Promise<{
		authorizationId: string;
		regionCode?: string;
		trace: ExternalTrace;
	}>;
	uploadFees(
		input: {
			orderId: string;
			patientId: string;
			authorizationId: string;
			totalFen: number;
			insuranceFen: number;
			cashFen: number;
		},
		context: AdapterCallContext,
	): Promise<{
		/** 仅是服务端引用；不得把 6201 的 payToken 或原始 envelope 放入此字段。 */
		feeUploadId: string;
		trace: ExternalTrace;
	}>;
	settle(
		input: {
			orderId: string;
			authorizationId: string;
			feeUploadId: string;
		},
		context: AdapterCallContext,
	): Promise<{
		state: MedicalInsuranceSettlementState;
		amounts: PaymentAmounts;
		trace: ExternalTrace;
	}>;
	query(
		input: {
			orderId: string;
		},
		context: AdapterCallContext,
	): Promise<MedicalInsuranceSettlementEvidence>;
}

export interface WechatPaymentGateway {
	createJsapiOrder(
		input: {
			orderId: string;
			openid: string;
			totalFen: number;
		},
		context: AdapterCallContext,
	): Promise<{
		prepayId: string;
		payParams: WechatMiniProgramPayParams;
		trace: ExternalTrace;
	}>;
	query(
		input: {
			orderId: string;
		},
		context: AdapterCallContext,
	): Promise<{
		state: WechatPaymentQueryState;
		totalFen: number;
		trace: ExternalTrace;
	}>;
}

export interface HospitalSettlementGateway {
	writeBack(
		input: {
			orderId: string;
			settlement: PaymentOrderSnapshot;
		},
		context: AdapterCallContext,
	): Promise<ExternalTrace>;
}
