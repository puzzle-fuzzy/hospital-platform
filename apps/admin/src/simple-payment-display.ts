import { formatAdminTime } from "./admin-time";
import {
	hasPendingRefund,
	hasRefundReceipt,
	paymentRefundOption,
} from "./payment-refund-options";
import type { AdminWechatRefundPaymentRecord } from "./types";

const completedWechatStates = new Set([
	"cash_paid",
	"his_written_back",
	"completed",
]);

function validFen(value: number | null | undefined): value is number {
	return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function yuan(value: number): string {
	return `¥${(value / 100).toFixed(2)}`;
}

function businessLabel(record: AdminWechatRefundPaymentRecord): string {
	if (record.business === "registration") return "挂号";
	if (record.business === "outpatient") return "门诊缴费";
	return "其他缴费";
}

/** Only original confirmed payment facts may be described as money paid. */
export function simplePaymentSentence(
	record: AdminWechatRefundPaymentRecord,
): string {
	const subject = `${formatAdminTime(record.createdAt)} 下单，${record.patientDisplayName?.trim() || "未关联就诊人"}${businessLabel(record)}`;
	const { actualPaidFen, actualCashFen, insuranceFen } = record;
	if (
		record.amountBreakdownStatus !== "confirmed" ||
		!validFen(actualPaidFen) ||
		!validFen(insuranceFen) ||
		!validFen(actualCashFen) ||
		actualPaidFen !== insuranceFen + actualCashFen
	)
		return `${subject}，金额待确认。`;
	// The read model uses false for a pure insurance payment with no cash leg.
	const cashConfirmed = actualCashFen === 0 || record.cashPaymentConfirmed;
	const medicalConfirmed =
		record.source === "medical_insurance"
			? record.medicalStatus === "insurance_settled"
			: insuranceFen === 0;
	const paymentCompleted =
		cashConfirmed &&
		medicalConfirmed &&
		(record.source === "medical_insurance" ||
			completedWechatStates.has(record.paymentState));
	if (paymentCompleted) {
		return `${subject}，已支付 ${yuan(actualPaidFen)}（医保 ${yuan(insuranceFen)}，微信 ${yuan(actualCashFen)}）。`;
	}
	const medical = medicalConfirmed ? yuan(insuranceFen) : "待确认";
	const cash = cashConfirmed ? yuan(actualCashFen) : "待确认";
	return `${subject}，支付未完成（医保 ${medical}，微信 ${cash}）。`;
}

export function simplePaymentRefundAction(
	record: AdminWechatRefundPaymentRecord,
	options: { readOnly: boolean; queryRequired: boolean; busy: boolean },
): { disabled: boolean; reason?: string; showQuery: boolean } {
	const refund = paymentRefundOption(record, "ALL");
	const showQuery = hasRefundReceipt(record) || options.queryRequired;
	if (options.readOnly)
		return {
			disabled: true,
			reason: "当前为只读查看账号，不能发起退费或查询退款状态。",
			showQuery,
		};
	if (options.queryRequired || hasPendingRefund(record))
		return {
			disabled: true,
			reason: "退款结果尚未确认，请先查询退款状态。",
			showQuery,
		};
	if (options.busy)
		return { disabled: true, reason: "正在查询退款状态，请稍候。", showQuery };
	return {
		disabled: !refund.enabled,
		...(refund.reason ? { reason: refund.reason } : {}),
		showQuery,
	};
}

/** Refund status is independent of the original payment amounts. */
export function simplePaymentRefundStatus(
	record: AdminWechatRefundPaymentRecord,
	queryRequired = false,
): "退款已完成" | "退款处理中" | "退款待核对" | undefined {
	if (queryRequired) return "退款待核对";
	const medical = record.latestMedicalRefund;
	const wechat = record.latestRefund;
	if (!medical && !wechat)
		return record.refundCount > 0 ? "退款待核对" : undefined;
	const pending = new Set(["requested", "processing"]);
	const completedLeg = new Set(["success", "not_required"]);
	if (
		(wechat && wechat.status !== "success" && !pending.has(wechat.status)) ||
		(medical &&
			((medical.status !== "succeeded" && !pending.has(medical.status)) ||
				[medical.medicalStatus, medical.wechatStatus].some(
					(status) => !completedLeg.has(status) && !pending.has(status),
				)))
	)
		return "退款待核对";
	if (
		(wechat && pending.has(wechat.status)) ||
		(medical &&
			(pending.has(medical.status) ||
				pending.has(medical.medicalStatus) ||
				pending.has(medical.wechatStatus)))
	)
		return "退款处理中";
	if (
		medical &&
		medical.medicalStatus !== "success" &&
		medical.wechatStatus !== "success"
	)
		return "退款待核对";
	return "退款已完成";
}
