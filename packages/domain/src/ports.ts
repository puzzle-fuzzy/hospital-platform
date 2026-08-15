import type { PaymentState } from "@hospital/contracts";

export type ExternalTrace = {
	provider: string;
	requestId: string;
	providerOrderId?: string;
};

export type PaymentOrderSnapshot = {
	orderId: string;
	state: PaymentState;
	totalFen: number;
	insuranceFen: number;
	cashFen: number;
	trace: ExternalTrace[];
};

export interface MedicalInsuranceGateway {
	authorize(input: {
		authCode: string;
		patientId: string;
	}): Promise<ExternalTrace>;
	uploadFees(input: {
		orderId: string;
		patientId: string;
	}): Promise<ExternalTrace>;
	settle(input: {
		orderId: string;
	}): Promise<{ state: PaymentState; trace: ExternalTrace }>;
	query(input: {
		orderId: string;
	}): Promise<{ state: PaymentState; trace: ExternalTrace }>;
}

export interface WechatPaymentGateway {
	createJsapiOrder(input: {
		orderId: string;
		openid: string;
		totalFen: number;
	}): Promise<{ prepayId: string; trace: ExternalTrace }>;
	query(input: {
		orderId: string;
	}): Promise<{ state: PaymentState; trace: ExternalTrace }>;
}

export interface HospitalSettlementGateway {
	writeBack(input: {
		orderId: string;
		settlement: PaymentOrderSnapshot;
	}): Promise<ExternalTrace>;
}
