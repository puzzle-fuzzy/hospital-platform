import type {
	AdminPaymentRefundOption,
	AdminPaymentRefundResult,
	AdminPaymentRefundType,
	AdminWechatRefundPaymentRecord,
} from "./types";

export function registrationRefundFeedback(
	result: AdminPaymentRefundResult,
):
	| { title: string; description: string; type: "info" | "warning" | "success" }
	| undefined {
	if (result.source !== "payment_order") return undefined;
	switch (result.registrationRefundStage) {
		case "wechat_refund_pending":
			return {
				title:
					result.status === "manual_review" || result.status === "failed"
						? "微信退款结果待确认"
						: "微信退款处理中",
				description:
					"请查询最新状态。微信退款确认成功后，系统才会回写医院并取消挂号。",
				type:
					result.status === "manual_review" || result.status === "failed"
						? "warning"
						: "info",
			};
		case "hospital_writeback_pending":
			return {
				title: "微信已退款，等待医院退费回写",
				description:
					"微信退款已确认成功；医院退费回写和取消挂号尚未完成，请查询最新状态。",
				type: "warning",
			};
		case "appointment_cancellation_pending":
			return {
				title: "微信已退款、医院已回写，等待取消挂号",
				description: "医院退费回写已确认，挂号尚未取消，请查询最新状态。",
				type: "warning",
			};
		case "completed":
			return result.status === "succeeded"
				? {
						title: "退款并取消挂号已完成",
						description: "微信退款、医院退费回写和取消挂号均已确认完成。",
						type: "success",
					}
				: {
						title: "退款并取消挂号结果待核对",
						description: "返回的处理阶段与结果不一致，请查询最新状态。",
						type: "warning",
					};
		default:
			return undefined;
	}
}

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
