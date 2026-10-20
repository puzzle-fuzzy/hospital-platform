import { expect, test } from "bun:test";
import {
	simplePaymentRefundAction,
	simplePaymentRefundStatus,
	simplePaymentSentence,
} from "./simple-payment-display";
import type { AdminWechatRefundPaymentRecord } from "./types";

const record: AdminWechatRefundPaymentRecord = {
	source: "medical_insurance",
	orderId: "synthetic-order",
	business: "outpatient",
	patientDisplayName: "示例就诊人",
	totalFen: 2000,
	insuranceFen: 1000,
	paymentState: "cash_paid",
	medicalStatus: "insurance_settled",
	cashPaymentConfirmed: true,
	cashFen: 1000,
	actualCashFen: 600,
	hospitalDiscountFen: 400,
	actualPaidFen: 1600,
	amountBreakdownStatus: "confirmed",
	refundOptions: {
		ALL: { enabled: true, amountFen: 1600 },
		HI: { enabled: true, amountFen: 1000 },
		CASH: { enabled: true, amountFen: 600 },
	},
	refundReservedFen: 0,
	refundableFen: 600,
	refundCount: 0,
	refundRoute: "admin",
	createdAt: "2026-10-20T02:25:01Z",
	updatedAt: "2026-10-20T08:00:00Z",
};

test("uses explicitly labelled creation time in Beijing and excludes hospital discount from original payment", () => {
	const sentence = simplePaymentSentence(record);
	expect(sentence).toContain("2026/10/20 10:25:01 下单");
	expect(sentence).toContain(
		"示例就诊人门诊缴费，已支付 ¥16.00（医保 ¥10.00，微信 ¥6.00）",
	);
	expect(sentence).not.toContain("16:00:00");
	expect(sentence).not.toContain("¥20.00");
	expect(simplePaymentSentence({ ...record, refundReservedFen: 600 })).toBe(
		sentence,
	);
});

test("pure insurance payment does not require a cash payment receipt", () => {
	expect(
		simplePaymentSentence({
			...record,
			actualCashFen: 0,
			actualPaidFen: 1000,
			cashPaymentConfirmed: false,
			paymentState: "not_started",
		}),
	).toContain("已支付 ¥10.00（医保 ¥10.00，微信 ¥0.00）");
});

test("unconfirmed cash or incomplete insurance is never presented as a fully paid order", () => {
	const cashPending = simplePaymentSentence({
		...record,
		cashPaymentConfirmed: false,
		paymentState: "prepay_ready",
	});
	expect(cashPending).toContain("支付未完成（医保 ¥10.00，微信 待确认）");
	expect(cashPending).not.toContain("已支付");
	const medicalPending = simplePaymentSentence({
		...record,
		medicalStatus: "failed",
	});
	expect(medicalPending).toContain("支付未完成（医保 待确认，微信 ¥6.00）");
	expect(medicalPending).not.toContain("已支付");
});

test("ordinary WeChat paid states require a confirmed cash receipt", () => {
	for (const paymentState of ["cash_paid", "his_written_back", "completed"]) {
		expect(
			simplePaymentSentence({
				...record,
				source: "payment_order",
				insuranceFen: 0,
				actualPaidFen: 600,
				paymentState,
			}),
		).toContain("已支付 ¥6.00");
	}
	for (const paymentState of ["pending", "failed", "cancelled", "unknown"]) {
		expect(
			simplePaymentSentence({
				...record,
				source: "payment_order",
				insuranceFen: 0,
				actualPaidFen: 600,
				paymentState,
			}),
		).not.toContain("已支付");
	}
});

test("unverified or inconsistent amounts and ambiguous timestamps remain visibly unconfirmed", () => {
	for (const changes of [
		{ amountBreakdownStatus: "unverified" as const },
		{ actualPaidFen: null },
		{ actualCashFen: -1 },
		{ actualPaidFen: 2000 },
		{ insuranceFen: Number.NaN },
	]) {
		expect(simplePaymentSentence({ ...record, ...changes })).toContain(
			"金额待确认",
		);
	}
	const missing = simplePaymentSentence({
		...record,
		patientDisplayName: " ",
		createdAt: "2026-10-20 10:25:01",
	});
	expect(missing).toContain("时间待核实 下单，未关联就诊人门诊缴费");
});

test("viewer and unresolved refund receipts cannot enable a new refund", () => {
	const action = (
		changes: Partial<AdminWechatRefundPaymentRecord>,
		readOnly = false,
		queryRequired = false,
	) =>
		simplePaymentRefundAction(
			{ ...record, ...changes },
			{ readOnly, queryRequired, busy: false },
		);
	expect(action({}, true).disabled).toBe(true);
	expect(action({}, true).reason).toContain("只读");
	expect(action({}, false, true)).toMatchObject({
		disabled: true,
		showQuery: true,
	});
	expect(
		action({
			latestRefund: {
				merchantRefundNo: "synthetic-refund",
				status: "unknown",
				refundFen: 100,
				updatedAt: record.updatedAt,
			},
		}),
	).toMatchObject({ disabled: true, showQuery: true });
	const legacy = { ...record };
	delete legacy.refundOptions;
	expect(
		simplePaymentRefundAction(legacy, {
			readOnly: false,
			queryRequired: false,
			busy: false,
		}).disabled,
	).toBe(true);
	expect(action({}).disabled).toBe(false);
});

test("refund completion requires both required medical legs and any separate WeChat receipt to be confirmed", () => {
	const medical = {
		refundNo: "synthetic-medical-refund",
		status: "succeeded" as const,
		medicalStatus: "success",
		wechatStatus: "not_required",
		totalFen: 1000,
		updatedAt: record.updatedAt,
	};
	const withMedical = { ...record, latestMedicalRefund: medical };
	expect(simplePaymentRefundStatus(withMedical)).toBe("退款已完成");
	for (const wechatStatus of ["unknown", "failed"]) {
		expect(
			simplePaymentRefundStatus({
				...withMedical,
				latestMedicalRefund: { ...medical, wechatStatus },
			}),
		).toBe("退款待核对");
	}
	expect(
		simplePaymentRefundStatus({
			...withMedical,
			latestMedicalRefund: { ...medical, medicalStatus: "not_required" },
		}),
	).toBe("退款待核对");
	expect(
		simplePaymentRefundStatus({
			...withMedical,
			latestMedicalRefund: { ...medical, wechatStatus: "processing" },
		}),
	).toBe("退款处理中");
	expect(
		simplePaymentRefundStatus({
			...withMedical,
			latestRefund: {
				merchantRefundNo: "synthetic-cash-refund",
				status: "unknown",
				refundFen: 100,
				updatedAt: record.updatedAt,
			},
		}),
	).toBe("退款待核对");
	expect(simplePaymentRefundStatus(withMedical, true)).toBe("退款待核对");
	expect(simplePaymentSentence(withMedical)).toContain("已支付 ¥16.00");
});

test("plain WeChat refund status is not inferred from original paid amount or refund reservations", () => {
	const wechat = {
		merchantRefundNo: "synthetic-cash-refund",
		status: "success" as const,
		refundFen: 100,
		updatedAt: record.updatedAt,
	};
	expect(simplePaymentRefundStatus({ ...record, latestRefund: wechat })).toBe(
		"退款已完成",
	);
	expect(
		simplePaymentRefundStatus({
			...record,
			latestRefund: { ...wechat, status: "processing" },
		}),
	).toBe("退款处理中");
	expect(
		simplePaymentRefundStatus({
			...record,
			latestRefund: { ...wechat, status: "abnormal" },
		}),
	).toBe("退款待核对");
	expect(simplePaymentRefundStatus({ ...record, refundCount: 1 })).toBe(
		"退款待核对",
	);
	expect(simplePaymentRefundStatus(record)).toBeUndefined();
});
