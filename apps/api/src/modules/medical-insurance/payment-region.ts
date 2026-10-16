import {
	MedicalInsuranceRegionUnsupportedError,
	MedicalInsuranceRegistrationInputError,
} from "./errors";

export type MedicalInsurancePaymentEligibility =
	| "unknown"
	| "supported"
	| "unsupported";

/** 仅接受服务端 1101 已选有效险种的参保地，不能使用授权 city_id 或就医地代替。 */
export function medicalInsurancePaymentEligibility(
	insuredAreaCode: unknown,
): MedicalInsurancePaymentEligibility {
	if (typeof insuredAreaCode !== "string" || !/^\d{6}$/.test(insuredAreaCode)) {
		return "unknown";
	}
	return insuredAreaCode === "140581" ? "supported" : "unsupported";
}

export function assertMedicalInsurancePaymentRegion(
	insuredAreaCode: unknown,
): void {
	const eligibility = medicalInsurancePaymentEligibility(insuredAreaCode);
	if (eligibility === "unsupported") {
		throw new MedicalInsuranceRegionUnsupportedError();
	}
	if (eligibility === "unknown") {
		throw new MedicalInsuranceRegistrationInputError(
			"当前参保地信息不可用，请重新医保授权",
		);
	}
}
