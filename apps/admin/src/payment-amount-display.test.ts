import { expect, test } from "bun:test";
import {
	formatPaymentAmount,
	paymentAmountLines,
} from "./payment-amount-display";
import type { AdminWechatRefundPaymentRecord } from "./types";

function payment(
	overrides: Partial<AdminWechatRefundPaymentRecord> = {},
): AdminWechatRefundPaymentRecord {
	return {
		source: "medical_insurance",
		orderId: "display-medical-order",
		business: "outpatient",
		totalFen: 1000,
		insuranceFen: 800,
		cashFen: 200,
		actualCashFen: 0,
		hospitalDiscountFen: 200,
		actualPaidFen: 800,
		amountBreakdownStatus: "confirmed",
		paymentState: "cash_paid",
		cashPaymentConfirmed: true,
		refundReservedFen: 0,
		refundableFen: 0,
		refundCount: 0,
		refundRoute: "admin",
		createdAt: "2026-10-15T08:00:00.000Z",
		updatedAt: "2026-10-15T08:00:00.000Z",
		...overrides,
	};
}

test("订单10元、医保8元和医院减免2元时，微信实付为零且实付款只取800分", () => {
	expect(paymentAmountLines(payment(), false)).toEqual([
		"订单总额 1,000 分（¥10.00）",
		"医保支付 800 分（¥8.00）",
		"微信实付 0 分（¥0.00）",
		"医院减免 200 分（¥2.00）（不退款）",
		"实付款 800 分（¥8.00）",
	]);
});

test("未知拆分显示待核实，不从原cashFen或剩余退款能力猜测实付", () => {
	const record = payment({
		actualCashFen: null,
		hospitalDiscountFen: null,
		actualPaidFen: null,
		amountBreakdownStatus: "unverified",
		refundOptions: {
			ALL: { enabled: false, amountFen: 800 },
			HI: { enabled: false, amountFen: 800 },
			CASH: { enabled: false, amountFen: 200 },
		},
	});
	const lines = paymentAmountLines(record);
	expect(lines).toContain("微信实付 待核实");
	expect(lines).toContain("医院减免 待核实（不退款）");
	expect(lines).toContain("实付款 待核实");
	expect(lines.join("；")).not.toContain("¥2.00");
});

test("未核实的旧金额缓存不能显示成已确认金额", () => {
	const lines = paymentAmountLines(
		payment({ amountBreakdownStatus: "unverified" }),
	);
	expect(lines).toContain("微信实付 待核实");
	expect(lines).toContain("医院减免 待核实（不退款）");
	expect(lines).toContain("实付款 待核实");
});

test("计划微信200分尚未确认付款时，不将计划额标为微信实付或实付款", () => {
	const record = payment({
		actualCashFen: 200,
		hospitalDiscountFen: 0,
		actualPaidFen: 1000,
		cashPaymentConfirmed: false,
	});
	expect(paymentAmountLines(record, false)).toContain("微信实付 待确认");
	expect(paymentAmountLines(record, false)).toContain("实付款 待确认");
	expect(paymentAmountLines(record, true)).toContain(
		"微信实付 200 分（¥2.00）",
	);
});

test("部分退款后仍展示原实付款，不能拿剩余退款额度替代原实付款", () => {
	const record = payment({
		totalFen: 8000,
		insuranceFen: 1320,
		actualCashFen: 6680,
		hospitalDiscountFen: 0,
		actualPaidFen: 8000,
		medicalRefundableFen: 0,
		refundOptions: {
			ALL: { enabled: true, amountFen: 6680 },
			HI: { enabled: false, amountFen: 0 },
			CASH: { enabled: true, amountFen: 6680 },
		},
	});
	expect(paymentAmountLines(record)).toContain("实付款 8,000 分（¥80.00）");
});

test("合计不能用订单总额减医院减免重新推算，缺少actualPaid时保持待核实", () => {
	const lines = paymentAmountLines(payment({ actualPaidFen: null }));
	expect(lines).toContain("实付款 待核实");
	expect(lines).not.toContain("实付款 800 分（¥8.00）");
	expect(formatPaymentAmount(null)).toBe("待核实");
	expect(formatPaymentAmount(undefined)).toBe("待核实");
});
