/** HIS 必须返回本次正金额支付分项中实际存在的医保结果。 */
export function medicalInsuranceGroupPayTypeId(
	parameters: readonly { payTypeId: string | number; amountFen: number }[],
): "2" | "5" {
	if (
		parameters.some(
			(parameter) =>
				!Number.isSafeInteger(parameter.amountFen) || parameter.amountFen < 0,
		)
	) {
		throw new Error("medical-insurance-group-payment-amount-invalid");
	}
	for (const payTypeId of ["2", "5"] as const) {
		if (
			parameters.some(
				(parameter) =>
					String(parameter.payTypeId) === payTypeId && parameter.amountFen > 0,
			)
		) {
			return payTypeId;
		}
	}
	throw new Error("medical-insurance-group-pay-type-unavailable");
}
