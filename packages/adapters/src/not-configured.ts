import type {
	HospitalSettlementGateway,
	MedicalInsuranceGateway,
	WechatIdentityGateway,
	WechatPaymentGateway,
} from "@hospital/domain";
import { AdapterNotConfiguredError } from "./errors";

function unavailable(
	adapter: "medical-insurance" | "wechat-pay" | "wechat-identity" | "yunhealth",
): never {
	throw new AdapterNotConfiguredError(adapter);
}

export type NotConfiguredGateways = {
	wechatIdentity: WechatIdentityGateway;
	medicalInsurance: MedicalInsuranceGateway;
	wechatPayment: WechatPaymentGateway;
	hospitalSettlement: HospitalSettlementGateway;
};

export function createNotConfiguredGateways(): NotConfiguredGateways {
	const wechatIdentity: WechatIdentityGateway = {
		exchangeCode: async (_input, _context) => unavailable("wechat-identity"),
	};
	const medicalInsurance: MedicalInsuranceGateway = {
		authorize: async (_input, _context) => unavailable("medical-insurance"),
		uploadFees: async (_input, _context) => unavailable("medical-insurance"),
		settle: async (_input, _context) => unavailable("medical-insurance"),
		query: async (_input, _context) => unavailable("medical-insurance"),
	};
	const wechatPayment: WechatPaymentGateway = {
		createJsapiOrder: async (_input, _context) => unavailable("wechat-pay"),
		query: async (_input, _context) => unavailable("wechat-pay"),
	};
	const hospitalSettlement: HospitalSettlementGateway = {
		writeBack: async (_input, _context) => unavailable("yunhealth"),
	};

	return {
		wechatIdentity,
		medicalInsurance,
		wechatPayment,
		hospitalSettlement,
	};
}
