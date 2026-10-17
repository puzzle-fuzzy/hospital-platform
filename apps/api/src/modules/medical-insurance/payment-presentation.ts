import {
	assertValidMedicalInsuranceAmounts,
	type MedicalInsuranceOrder,
	type MedicalInsuranceOrderRepository,
	type MedicalInsuranceSettlementContext,
	medicalInsurancePaymentBreakdown,
} from "@hospital/domain";

/** 展示专用；6202 cashFen 和实际支付、状态、回写数据均不在这里改写。 */
export type MedicalInsurancePaymentPresentation = {
	hospitalPartFen?: number;
	hospitalReduceFen?: number;
	wechatCashFen?: number;
};

export function medicalInsurancePaymentPresentation(
	order: MedicalInsuranceOrder,
	settlement?: MedicalInsuranceSettlementContext,
): MedicalInsurancePaymentPresentation {
	if (!order.amounts) return {};
	const insuredAreaCode = settlement?.insuredAreaCode?.trim();
	const businessType =
		order.businessType ?? (order.appointmentId ? "registration" : undefined);
	const orderType =
		order.orderType ??
		(businessType === "registration"
			? "RegPay"
			: businessType === "outpatient"
				? "DiagPay"
				: undefined);
	if (!insuredAreaCode || !/^\d{6}$/.test(insuredAreaCode) || !orderType)
		return {};
	if (
		(businessType === "registration" && orderType !== "RegPay") ||
		(businessType === "outpatient" && orderType !== "DiagPay")
	)
		return {};
	try {
		const amounts = assertValidMedicalInsuranceAmounts(order.amounts);
		// 历史已完成订单优先展示已成功记账的腿，不把今天的优惠规则追溯到旧实付。
		const paidLegs = (settlement?.postPaymentComponents ?? [])
			.filter((component) => component.state === "succeeded")
			.flatMap<{ kind: string; amountFen: number }>((component) =>
				component.kind === "combined" || component.kind === "medical"
					? (component.payTypeParams ?? [])
					: [component],
			)
			.filter(
				(leg) => leg.kind === "hospital_reduce" || leg.kind === "wechat_cash",
			);
		if (order.status === "insurance_settled" && paidLegs.length > 0) {
			if (
				paidLegs.some(
					(leg) => !Number.isSafeInteger(leg.amountFen) || leg.amountFen < 0,
				)
			)
				return {};
			const wechatCashFen = paidLegs.reduce(
				(sum, leg) => sum + (leg.kind === "wechat_cash" ? leg.amountFen : 0),
				0,
			);
			// payType 50 已含 othFeeAmt 内的医院负担，该部分不能再次抵扣 ownPayAmt。
			const hospitalReduceFen =
				paidLegs.reduce(
					(sum, leg) =>
						sum + (leg.kind === "hospital_reduce" ? leg.amountFen : 0),
					0,
				) - (amounts.hospitalPartFen ?? 0);
			return Number.isSafeInteger(wechatCashFen) &&
				Number.isSafeInteger(hospitalReduceFen) &&
				hospitalReduceFen >= 0 &&
				wechatCashFen + hospitalReduceFen === amounts.cashFen
				? {
						hospitalPartFen: amounts.hospitalPartFen ?? 0,
						hospitalReduceFen,
						wechatCashFen,
					}
				: {};
		}
		if (order.status === "insurance_settled" && amounts.cashFen > 0) return {};
		const breakdown = medicalInsurancePaymentBreakdown({
			amounts,
			orderType,
			insuredAreaCode,
		});
		return {
			hospitalPartFen: amounts.hospitalPartFen ?? 0,
			hospitalReduceFen: breakdown.cashReduceDetails.reduce(
				(sum, detail) => sum + detail.cashReduceFen,
				0,
			),
			wechatCashFen: breakdown.wechatCashFen,
		};
	} catch {
		// 展示信息不完整时保留原始金额，不阻断查单或改变支付结果。
		return {};
	}
}

export async function loadMedicalInsurancePaymentPresentation(
	order: MedicalInsuranceOrder,
	orders: MedicalInsuranceOrderRepository,
): Promise<MedicalInsurancePaymentPresentation> {
	if (!order.amounts) return {};
	try {
		return medicalInsurancePaymentPresentation(
			order,
			await orders.getSettlementContext(
				order.ownerUserId,
				order.medicalOrderId,
			),
		);
	} catch {
		return {};
	}
}
