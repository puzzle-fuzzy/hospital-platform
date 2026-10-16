import { expect, test } from "bun:test";
import { MedicalInsuranceRegionUnsupportedError } from "./errors";
import {
	assertMedicalInsurancePaymentRegion,
	medicalInsurancePaymentEligibility,
} from "./payment-region";

test("仅高平六位参保地区划可以医保，同省同市也不放行", () => {
	expect(medicalInsurancePaymentEligibility("140581")).toBe("supported");
	for (const region of ["140500", "140582", "330106", "140000"]) {
		expect(medicalInsurancePaymentEligibility(region)).toBe("unsupported");
		expect(() => assertMedicalInsurancePaymentRegion(region)).toThrow(
			MedicalInsuranceRegionUnsupportedError,
		);
	}
	for (const region of [undefined, null, "", 140581, "1405", " 140581 "]) {
		expect(medicalInsurancePaymentEligibility(region)).toBe("unknown");
		expect(() => assertMedicalInsurancePaymentRegion(region)).toThrow();
	}
});
