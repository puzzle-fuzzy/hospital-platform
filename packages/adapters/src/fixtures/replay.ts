import type {
	AdapterCallContext,
	ExternalTrace,
	HospitalSettlementGateway,
	MedicalInsuranceGateway,
	WechatPaymentGateway,
} from "@hospital/domain";
import type { PaymentState } from "@hospital/contracts";

function trace(
	provider: string,
	operation: string,
	context: AdapterCallContext,
	providerOrderId?: string,
): ExternalTrace {
	return {
		provider,
		operation,
		requestId: context.traceId,
		...(providerOrderId ? { providerOrderId } : {}),
	};
}

/** Test-only deterministic provider responses. Never register this in production. */
export function createFixtureMedicalInsuranceGateway(): MedicalInsuranceGateway {
	return {
		authorize: async (_input, context) => ({
			authorizationId: "fixture-auth-001",
			regionCode: "140581",
			trace: trace(
				"fixture-medical-insurance",
				"1101",
				context,
				"fixture-auth-001",
			),
		}),
		uploadFees: async (_input, context) => ({
			feeUploadId: "fixture-fee-001",
			trace: trace(
				"fixture-medical-insurance",
				"6201",
				context,
				"fixture-fee-001",
			),
		}),
		settle: async (_input, context) => ({
			state: "insurance_settled" as PaymentState,
			totalFen: 10_000,
			insuranceFen: 8_000,
			cashFen: 2_000,
			trace: trace(
				"fixture-medical-insurance",
				"6202",
				context,
				"fixture-pay-001",
			),
		}),
		query: async (_input, context) => ({
			state: "insurance_settled" as PaymentState,
			trace: trace(
				"fixture-medical-insurance",
				"6301",
				context,
				"fixture-pay-001",
			),
		}),
	};
}

export function createFixtureWechatPaymentGateway(): WechatPaymentGateway {
	return {
		createJsapiOrder: async (_input, context) => ({
			prepayId: "fixture-prepay-001",
			trace: trace(
				"fixture-wechat-pay",
				"jsapi-prepay",
				context,
				"fixture-pay-001",
			),
		}),
		query: async (_input, context) => ({
			state: "cash_paid" as PaymentState,
			trace: trace(
				"fixture-wechat-pay",
				"order-query",
				context,
				"fixture-pay-001",
			),
		}),
	};
}

export function createFixtureHospitalSettlementGateway(): HospitalSettlementGateway {
	return {
		writeBack: async (_input, context) =>
			trace(
				"fixture-yunhealth",
				"settlement-write-back",
				context,
				"fixture-his-001",
			),
	};
}
