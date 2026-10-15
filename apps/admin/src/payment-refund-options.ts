import type {
	AdminPaymentRefundOption,
	AdminPaymentRefundType,
	AdminWechatRefundPaymentRecord,
} from "./types";

export const PAYMENT_REFUND_TYPES: readonly AdminPaymentRefundType[] = [
	"ALL",
	"HI",
	"CASH",
];

export const PAYMENT_REFUND_LABELS: Record<AdminPaymentRefundType, string> = {
	ALL: "整笔退款（剩余实付）",
	HI: "只退医保",
	CASH: "只退微信",
};

export function paymentRefundLabel(
	record: AdminWechatRefundPaymentRecord,
	type: AdminPaymentRefundType,
): string {
	if (
		record.source === "payment_order" &&
		record.refundRoute === "appointment_cancel" &&
		type !== "HI"
	)
		return type === "ALL" ? "整笔退款并取消挂号" : "退微信并取消挂号";
	return PAYMENT_REFUND_LABELS[type];
}

export function paymentRefundKey(
	record: Pick<AdminWechatRefundPaymentRecord, "source" | "orderId">,
): string {
	return `${record.source}:${record.orderId}`;
}

export function hasRefundReceipt(
	record: AdminWechatRefundPaymentRecord,
): boolean {
	return Boolean(record.latestMedicalRefund || record.latestRefund);
}

export function hasPendingRefund(
	record: AdminWechatRefundPaymentRecord,
): boolean {
	const pending = new Set(["requested", "processing", "unknown"]);
	return Boolean(
		(record.latestRefund && pending.has(record.latestRefund.status)) ||
			(record.latestMedicalRefund &&
				(pending.has(record.latestMedicalRefund.status) ||
					pending.has(record.latestMedicalRefund.medicalStatus) ||
					pending.has(record.latestMedicalRefund.wechatStatus))),
	);
}

export function paymentRefundOption(
	record: AdminWechatRefundPaymentRecord,
	refundType: AdminPaymentRefundType,
): AdminPaymentRefundOption {
	const option = record.refundOptions?.[refundType];
	if (!option) {
		return {
			enabled: false,
			amountFen: 0,
			reason: "退款能力暂不可用，请刷新支付数据或查询已有退款",
		};
	}
	if (hasPendingRefund(record)) {
		return {
			...option,
			enabled: false,
			reason: "已有退款处理中或结果未确认，请先查询退款状态",
		};
	}
	if (record.source === "payment_order" && refundType === "HI") {
		return {
			...option,
			enabled: false,
			reason: "普通微信订单没有医保实付金额",
		};
	}
	if (!Number.isSafeInteger(option.amountFen) || option.amountFen <= 0) {
		return {
			...option,
			enabled: false,
			reason: option.reason || "所选范围没有剩余可退实付金额",
		};
	}
	return option;
}

export function paymentRefundPreview(
	record: AdminWechatRefundPaymentRecord,
	refundType: AdminPaymentRefundType,
): {
	totalFen: number;
	cashFen: number | undefined;
	medicalFen: number | undefined;
} {
	return {
		totalFen: paymentRefundOption(record, refundType).amountFen,
		cashFen: refundType === "HI" ? 0 : record.refundOptions?.CASH.amountFen,
		medicalFen: refundType === "CASH" ? 0 : record.refundOptions?.HI.amountFen,
	};
}
