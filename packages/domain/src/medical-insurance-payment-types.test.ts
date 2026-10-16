import { expect, test } from "bun:test";
import { medicalInsuranceGroupPayTypeId } from "./medical-insurance-payment-types";

test("有统筹金额时优先返回统筹，不受分项顺序和数字类型影响", () => {
	expect(
		medicalInsuranceGroupPayTypeId([
			{ payTypeId: "5", amountFen: 300 },
			{ payTypeId: "50", amountFen: 200 },
			{ payTypeId: 2, amountFen: 500 },
		]),
	).toBe("2");
});

test("无统筹的个账支付返回个账，零金额统筹不能成为返回类型", () => {
	expect(
		medicalInsuranceGroupPayTypeId([
			{ payTypeId: "2", amountFen: 0 },
			{ payTypeId: 5, amountFen: 1000 },
		]),
	).toBe("5");
});

test("医院优惠或微信现金不能代替医保返回类型", () => {
	for (const parameters of [
		[],
		[{ payTypeId: "50", amountFen: 1000 }],
		[{ payTypeId: "5033", amountFen: 1000 }],
		[
			{ payTypeId: "2", amountFen: 0 },
			{ payTypeId: "5", amountFen: 0 },
		],
	]) {
		expect(() => medicalInsuranceGroupPayTypeId(parameters)).toThrow(
			"medical-insurance-group-pay-type-unavailable",
		);
	}
});

test("金额不合法时不能选择外层支付类型", () => {
	for (const amountFen of [-1, 0.5, Number.NaN, Number.MAX_SAFE_INTEGER + 1]) {
		expect(() =>
			medicalInsuranceGroupPayTypeId([
				{ payTypeId: "2", amountFen: 1000 },
				{ payTypeId: "5", amountFen },
			]),
		).toThrow("medical-insurance-group-payment-amount-invalid");
	}
});
