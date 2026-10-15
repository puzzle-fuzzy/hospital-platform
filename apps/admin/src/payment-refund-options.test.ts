import { describe, expect, test } from "bun:test";
import {
	hasPendingRefund,
	hasRefundReceipt,
	PAYMENT_REFUND_TYPES,
	paymentRefundLabel,
	paymentRefundOption,
	paymentRefundPreview,
} from "./payment-refund-options";
import type { AdminWechatRefundPaymentRecord } from "./types";

function payment(
	overrides: Partial<AdminWechatRefundPaymentRecord> = {},
): AdminWechatRefundPaymentRecord {
	return {
		source: "medical_insurance",
		orderId: "test-medical-order",
		business: "outpatient",
		totalFen: 8000,
		insuranceFen: 1320,
		cashFen: 6680,
		actualCashFen: 6680,
		hospitalDiscountFen: 0,
		actualPaidFen: 8000,
		amountBreakdownStatus: "confirmed",
		personalAccountFen: 0,
		fundFen: 1320,
		medicalRefundableFen: 1320,
		paymentState: "cash_paid",
		cashPaymentConfirmed: true,
		refundReservedFen: 0,
		refundableFen: 6680,
		refundCount: 0,
		refundRoute: "admin",
		createdAt: "2026-10-15T00:00:00.000Z",
		updatedAt: "2026-10-15T00:00:00.000Z",
		refundOptions: {
			ALL: { enabled: true, amountFen: 8000 },
			HI: { enabled: true, amountFen: 1320 },
			CASH: { enabled: true, amountFen: 6680 },
		},
		...overrides,
	};
}

describe("admin refund scope and authoritative capabilities", () => {
	test("three scopes confirm only their original payment channels", () => {
		const record = payment();
		expect(paymentRefundPreview(record, "ALL")).toEqual({
			totalFen: 8000,
			medicalFen: 1320,
			cashFen: 6680,
		});
		expect(paymentRefundPreview(record, "HI")).toEqual({
			totalFen: 1320,
			medicalFen: 1320,
			cashFen: 0,
		});
		expect(paymentRefundPreview(record, "CASH")).toEqual({
			totalFen: 6680,
			medicalFen: 0,
			cashFen: 6680,
		});
	});

	test("hospital reduction never becomes cash in the confirmation", () => {
		const record = payment({
			totalFen: 1000,
			cashFen: 200,
			actualCashFen: 0,
			hospitalDiscountFen: 200,
			actualPaidFen: 800,
			fundFen: 800,
			refundableFen: 0,
			medicalRefundableFen: 800,
			refundOptions: {
				ALL: { enabled: true, amountFen: 800 },
				HI: { enabled: true, amountFen: 800 },
				CASH: { enabled: false, amountFen: 0, reason: "无微信实付" },
			},
		});
		expect(paymentRefundPreview(record, "ALL")).toEqual({
			totalFen: 800,
			medicalFen: 800,
			cashFen: 0,
		});
		expect(paymentRefundOption(record, "CASH").enabled).toBe(false);
	});

	test("confirmed medical success still permits remaining cash and full remainder", () => {
		const record = payment({
			medicalRefundableFen: 0,
			latestMedicalRefund: {
				refundNo: "test-hi-refund",
				status: "succeeded",
				medicalStatus: "success",
				wechatStatus: "not_required",
				totalFen: 1320,
				updatedAt: "2026-10-15T00:00:00.000Z",
			},
			refundOptions: {
				ALL: { enabled: true, amountFen: 6680 },
				HI: { enabled: false, amountFen: 0, reason: "医保已退" },
				CASH: { enabled: true, amountFen: 6680 },
			},
		});
		expect(hasRefundReceipt(record)).toBe(true);
		expect(hasPendingRefund(record)).toBe(false);
		expect(paymentRefundOption(record, "CASH").enabled).toBe(true);
		expect(paymentRefundPreview(record, "ALL")).toEqual({
			totalFen: 6680,
			medicalFen: 0,
			cashFen: 6680,
		});
		expect(paymentRefundOption(record, "HI").enabled).toBe(false);
	});

	test.each(["requested", "processing", "unknown"] as const)(
		"uncertain %s cash receipt allows only querying",
		(status) => {
			const record = payment({
				latestRefund: {
					merchantRefundNo: "test-wx-refund",
					status,
					refundFen: 6680,
					updatedAt: "2026-10-15T00:00:00.000Z",
				},
			});
			expect(hasPendingRefund(record)).toBe(true);
			for (const type of PAYMENT_REFUND_TYPES)
				expect(paymentRefundOption(record, type).enabled).toBe(false);
		},
	);

	test("uncertain medical leg blocks fresh requests even in manual review", () => {
		const record = payment({
			latestMedicalRefund: {
				refundNo: "test-unknown-refund",
				status: "manual_review",
				medicalStatus: "unknown",
				wechatStatus: "not_required",
				totalFen: 1320,
				updatedAt: "2026-10-15T00:00:00.000Z",
			},
		});
		for (const type of PAYMENT_REFUND_TYPES)
			expect(paymentRefundOption(record, type).enabled).toBe(false);
	});

	test("five fully refunded records disable every scope", () => {
		for (let index = 0; index < 5; index++) {
			const record = payment({
				orderId: `fully-refunded-${index}`,
				ordStas: "5",
				refundableFen: 0,
				medicalRefundableFen: 0,
				refundOptions: {
					ALL: { enabled: false, amountFen: 0, reason: "已全额退款" },
					HI: { enabled: false, amountFen: 0, reason: "医保已退" },
					CASH: { enabled: false, amountFen: 0, reason: "微信已退" },
				},
			});
			for (const type of PAYMENT_REFUND_TYPES)
				expect(paymentRefundOption(record, type).enabled).toBe(false);
		}
	});

	test("old capability payload permits receipt queries and disables all new actions", () => {
		const record = payment({
			latestRefund: {
				merchantRefundNo: "legacy-refund",
				status: "success",
				refundFen: 6680,
				updatedAt: "2026-10-15T00:00:00.000Z",
			},
		});
		delete record.refundOptions;
		expect(hasRefundReceipt(record)).toBe(true);
		for (const type of PAYMENT_REFUND_TYPES) {
			expect(paymentRefundOption(record, type).enabled).toBe(false);
			expect(paymentRefundOption(record, type).reason).toContain(
				"能力暂不可用",
			);
		}
	});

	test("ordinary paid Wechat permits full or cash and has no insurance channel", () => {
		const record = payment({
			source: "payment_order",
			refundOptions: {
				ALL: { enabled: true, amountFen: 6680 },
				CASH: { enabled: true, amountFen: 6680 },
				HI: { enabled: false, amountFen: 0 },
			},
		});
		expect(paymentRefundOption(record, "ALL").enabled).toBe(true);
		expect(paymentRefundOption(record, "CASH").enabled).toBe(true);
		expect(paymentRefundOption(record, "HI").enabled).toBe(false);
	});

	test("registration cancellation guard preserves the server explanation", () => {
		const record = payment({
			refundRoute: "appointment_cancel",
			refundOptions: {
				ALL: { enabled: false, amountFen: 8000, reason: "挂号请先取消预约" },
				HI: { enabled: false, amountFen: 1320 },
				CASH: { enabled: false, amountFen: 6680 },
			},
		});
		expect(paymentRefundOption(record, "ALL").reason).toBe("挂号请先取消预约");
		for (const type of PAYMENT_REFUND_TYPES)
			expect(paymentRefundOption(record, type).enabled).toBe(false);
	});

	test("server-enabled completed registration offers refund and cancellation together", () => {
		const record = payment({
			source: "payment_order",
			refundRoute: "appointment_cancel",
			paymentState: "completed",
		});
		expect(paymentRefundOption(record, "ALL").enabled).toBe(true);
		expect(paymentRefundOption(record, "CASH").enabled).toBe(true);
		expect(paymentRefundLabel(record, "ALL")).toBe("整笔退款并取消挂号");
		expect(paymentRefundLabel(record, "CASH")).toBe("退微信并取消挂号");
	});
});
