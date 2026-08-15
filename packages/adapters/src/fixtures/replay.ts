import type {
	AdapterCallContext,
	ExternalTrace,
	HospitalSettlementGateway,
	MedicalInsuranceGateway,
	WechatIdentityGateway,
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

/** 测试专用的确定性微信身份响应；不能注册到生产组合根。 */
export function createFixtureWechatIdentityGateway(): WechatIdentityGateway {
	return {
		exchangeCode: async (_input, context) => ({
			providerSubject: "fixture-openid-001",
			unionId: "fixture-unionid-001",
			trace: trace(
				"fixture-wechat-identity",
				"code2session",
				context,
				"fixture-openid-001",
			),
		}),
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
			payParams: {
				appId: "fixture-app-id",
				timeStamp: "1700000000",
				nonceStr: "fixture-nonce-001",
				package: "prepay_id=fixture-prepay-001",
				signType: "RSA",
				paySign: "fixture-pay-sign-001",
			},
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
