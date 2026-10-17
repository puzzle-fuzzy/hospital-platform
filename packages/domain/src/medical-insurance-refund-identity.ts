import { createHash } from "node:crypto";
import { isBoundedOpaqueIdentifier } from "./opaque-identifier";

/** The identity is shared by Admin, HIS and medical refund result notifications. */
export function medicalInsuranceWechatCashRefundIdentity(orderId: string): {
	idempotencyKey: string;
	merchantRefundNo: string;
} {
	if (!isBoundedOpaqueIdentifier(orderId))
		throw new Error("invalid-refund-order-id");
	return {
		idempotencyKey: `his-medical-wechat-leg:${orderId}`,
		merchantRefundNo: `RFHIS${createHash("sha256").update(orderId, "utf8").digest("hex").slice(0, 56)}`,
	};
}
