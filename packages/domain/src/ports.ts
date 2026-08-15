import type { PaymentState } from "@hospital/contracts";

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

/** 支付订单的内部快照，金额统一使用整数分。 */
export type PaymentOrderSnapshot = {
	orderId: string;
	state: PaymentState;
	totalFen: number;
	insuranceFen: number;
	cashFen: number;
	trace: ExternalTrace[];
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
		state: PaymentState;
		totalFen: number;
		insuranceFen: number;
		cashFen: number;
		trace: ExternalTrace;
	}>;
	query(
		input: {
			orderId: string;
		},
		context: AdapterCallContext,
	): Promise<{
		state: PaymentState;
		trace: ExternalTrace;
	}>;
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
		trace: ExternalTrace;
	}>;
	query(
		input: {
			orderId: string;
		},
		context: AdapterCallContext,
	): Promise<{
		state: PaymentState;
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
