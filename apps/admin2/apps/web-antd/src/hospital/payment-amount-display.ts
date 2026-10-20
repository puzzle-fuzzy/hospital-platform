import type { AdminPaymentDisplayAmounts } from "./types";

type DisplayAmounts = AdminPaymentDisplayAmounts & {
	totalFen: number;
	insuranceFen?: number;
};

export function formatPaymentAmount(value: number | null | undefined): string {
	return typeof value === "number" && Number.isSafeInteger(value) && value >= 0
		? `${value.toLocaleString("zh-CN")} 分（¥${(value / 100).toFixed(2)}）`
		: "待核实";
}

/** 展示原支付事实；剩余退款能力继续由 refundOptions 决定。 */
export function paymentAmountLines(
	amounts: DisplayAmounts,
	cashPaymentConfirmed = true,
): string[] {
	const confirmed = amounts.amountBreakdownStatus === "confirmed";
	const cashPending =
		confirmed &&
		typeof amounts.actualCashFen === "number" &&
		amounts.actualCashFen > 0 &&
		!cashPaymentConfirmed;
	return [
		`订单总额 ${formatPaymentAmount(amounts.totalFen)}`,
		`医保支付 ${formatPaymentAmount(amounts.insuranceFen)}`,
		`微信实付 ${cashPending ? "待确认" : formatPaymentAmount(confirmed ? amounts.actualCashFen : null)}`,
		`医院减免 ${formatPaymentAmount(confirmed ? amounts.hospitalDiscountFen : null)}（不退款）`,
		`实付款 ${cashPending ? "待确认" : formatPaymentAmount(confirmed ? amounts.actualPaidFen : null)}`,
	];
}
