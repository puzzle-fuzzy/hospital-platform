import { createHash } from "node:crypto";

import type {
	PaymentAggregate,
	PaymentAggregateBusiness,
	PaymentAggregateStatus,
	PaymentLeg,
	PaymentLegStatus,
	PaymentLegType,
	PaymentOperationEvent,
	PaymentOperationsProjection,
} from "./payment-operations";
import type { MedicalInsuranceOrder } from "./medical-insurance-order";
import type { PaymentOrder } from "./payment-order";

function digest(value: string): string {
	return createHash("sha256").update(value, "utf8").digest("hex");
}

function stableId(prefix: string, value: string): string {
	return `${prefix}-${digest(value).slice(0, 56)}`;
}

function paymentBusiness(order: PaymentOrder): PaymentAggregateBusiness {
	if (order.idempotencyKey.startsWith("registration-self-pay:")) {
		return "registration";
	}
	if (order.idempotencyKey.startsWith("outpatient-self-pay:")) {
		return "outpatient";
	}
	return "other";
}

function paymentAggregateStatus(
	state: PaymentOrder["state"],
): PaymentAggregateStatus {
	if (
		state === "cash_paid" ||
		state === "his_written_back" ||
		state === "completed"
	) {
		return "paid";
	}
	if (state === "failed" || state === "cancelled") return "failed";
	return state === "created" ? "created" : "pending";
}

function paymentLegStatus(state: PaymentOrder["state"]): PaymentLegStatus {
	if (
		state === "cash_paid" ||
		state === "his_written_back" ||
		state === "completed"
	) {
		return "confirmed";
	}
	if (state === "failed" || state === "cancelled") return "failed";
	return state === "created" ? "not_started" : "pending";
}

function makeLeg(input: {
	aggregateId: string;
	legType: PaymentLegType;
	source: PaymentLeg["source"];
	sourceOrderId: string;
	amountFen: number;
	status: PaymentLegStatus;
	confirmedAt?: string;
	version: number;
	createdAt: string;
	updatedAt: string;
}): PaymentLeg {
	return {
		legId: stableId("payleg", `${input.aggregateId}:${input.legType}`),
		...input,
	};
}

function makeEvent(input: {
	aggregate: PaymentAggregate;
	legs: readonly PaymentLeg[];
	sourceOrderId: string;
	sourceVersion: number;
	previousStatus?: string;
	payload: Record<string, unknown>;
	eventAt: string;
}): PaymentOperationEvent {
	const idempotencyKey = `projection:payment_order:${input.sourceOrderId}:${input.sourceVersion}`;
	return {
		eventId: stableId("payevt", idempotencyKey),
		aggregateId: input.aggregate.aggregateId,
		source: "payment_order",
		eventType: "source_projection",
		...(input.previousStatus ? { previousStatus: input.previousStatus } : {}),
		nextStatus: input.aggregate.status,
		amountFen: input.aggregate.totalFen,
		idempotencyKey,
		eventAt: input.eventAt,
		payloadDigest: digest(
			JSON.stringify({
				aggregate: input.aggregate,
				legs: input.legs,
				payload: input.payload,
			}),
		),
	};
}

/** 普通 PaymentOrder 的确定性、低敏运营台投影构造器。 */
export function buildPaymentOrderOperationsProjection(
	order: PaymentOrder,
	existing?: PaymentAggregate,
): PaymentOperationsProjection {
	const businessKey = `payment_order:${order.orderId}`;
	const aggregateId = stableId("payagg", businessKey);
	const aggregate: PaymentAggregate = {
		aggregateId,
		ownerUserId: order.ownerUserId,
		patientId: order.patientId,
		business: paymentBusiness(order),
		businessKey,
		businessId: order.orderId,
		totalFen: order.amounts.totalFen,
		insuranceFen: order.amounts.insuranceFen,
		cashFen: order.amounts.cashFen,
		status: paymentAggregateStatus(order.state),
		hisSyncStatus: "not_required",
		sourceVersion: order.version,
		version: (existing?.version ?? 0) + 1,
		createdAt: order.createdAt,
		updatedAt: order.updatedAt,
	};
	const legStatus = paymentLegStatus(order.state);
	const leg = makeLeg({
		aggregateId,
		legType: "wechat_cash",
		source: "payment_order",
		sourceOrderId: order.orderId,
		amountFen: order.amounts.cashFen,
		status: legStatus,
		...(legStatus === "confirmed" ? { confirmedAt: order.updatedAt } : {}),
		version: (existing?.version ?? 0) + 1,
		createdAt: order.createdAt,
		updatedAt: order.updatedAt,
	});
	return {
		aggregate,
		legs: [leg],
		event: makeEvent({
			aggregate,
			legs: [leg],
			sourceOrderId: order.orderId,
			sourceVersion: order.version,
			...(existing ? { previousStatus: existing.status } : {}),
			payload: { state: order.state, business: aggregate.business },
			eventAt: order.updatedAt,
		}),
	};
}

function medicalBusiness(
	order: MedicalInsuranceOrder,
): PaymentAggregateBusiness {
	return order.businessType === "outpatient" || order.orderType === "DiagPay"
		? "outpatient"
		: "registration";
}

function medicalAggregateStatus(
	order: MedicalInsuranceOrder,
): PaymentAggregateStatus {
	if (
		order.status === "manual_review" ||
		order.status === "awaiting_confirmation"
	) {
		return "manual_review";
	}
	if (order.status === "failed" || order.status === "cancelled")
		return "failed";
	if (
		order.status === "insurance_settled" &&
		(order.amounts?.cashFen ?? 0) === 0
	) {
		return "paid";
	}
	if (
		order.status === "insurance_settled" &&
		order.wechatPaymentState === "cash_paid"
	) {
		return "paid";
	}
	return order.status === "created" ? "created" : "pending";
}

function medicalLegStatus(order: MedicalInsuranceOrder): {
	insurance: PaymentLegStatus;
	cash: PaymentLegStatus;
} {
	const insurance =
		order.status === "insurance_settled"
			? "confirmed"
			: order.status === "failed" || order.status === "cancelled"
				? "failed"
				: order.status === "manual_review" ||
						order.status === "awaiting_confirmation"
					? "manual_review"
					: order.status === "created"
						? "not_started"
						: "pending";
	const cash =
		order.wechatPaymentState === "cash_paid"
			? "confirmed"
			: order.wechatPaymentState === "failed" ||
					order.status === "failed" ||
					order.status === "cancelled"
				? "failed"
				: order.wechatPaymentState === "unknown" ||
						order.status === "manual_review" ||
						order.status === "awaiting_confirmation"
					? "manual_review"
					: order.wechatPaymentState === "prepay_ready"
						? "pending"
						: "not_started";
	return { insurance, cash };
}

/** 医保订单的确定性、低敏运营台投影构造器。 */
export function buildMedicalInsuranceOrderOperationsProjection(
	order: MedicalInsuranceOrder,
	existing?: PaymentAggregate,
): PaymentOperationsProjection | undefined {
	if (!order.amounts) return undefined;
	const businessKey = `medical_insurance:${order.medicalOrderId}`;
	const aggregateId = stableId("payagg", businessKey);
	const insuranceFen = order.amounts.totalFen - order.amounts.cashFen;
	const aggregate: PaymentAggregate = {
		aggregateId,
		ownerUserId: order.ownerUserId,
		patientId: order.patientId,
		business: medicalBusiness(order),
		businessKey,
		businessId: order.businessId ?? order.medicalOrderId,
		totalFen: order.amounts.totalFen,
		insuranceFen,
		cashFen: order.amounts.cashFen,
		status: medicalAggregateStatus(order),
		hisSyncStatus:
			order.status === "failed" || order.status === "cancelled"
				? "not_required"
				: "pending",
		sourceVersion: order.version,
		version: (existing?.version ?? 0) + 1,
		createdAt: order.createdAt,
		updatedAt: order.updatedAt,
	};
	const statuses = medicalLegStatus(order);
	const insuranceLeg: PaymentLeg = {
		legId: stableId("payleg", `${aggregateId}:medical_insurance`),
		aggregateId,
		legType: "medical_insurance",
		source: "medical_insurance",
		sourceOrderId: order.medicalOrderId,
		amountFen: insuranceFen,
		status: statuses.insurance,
		...(order.payOrdId || order.medOrgOrd
			? {
					providerReferenceDigest: digest(
						order.payOrdId ?? order.medOrgOrd,
					),
				}
			: {}),
		...(statuses.insurance === "confirmed"
			? { confirmedAt: order.updatedAt }
			: {}),
		version: (existing?.version ?? 0) + 1,
		createdAt: order.createdAt,
		updatedAt: order.updatedAt,
	};
	const legs: PaymentLeg[] = [insuranceLeg];
	if (order.amounts.cashFen > 0) {
		legs.push({
			legId: stableId("payleg", `${aggregateId}:wechat_cash`),
			aggregateId,
			legType: "wechat_cash",
			source: "wechat_pay",
			sourceOrderId: order.medicalOrderId,
			amountFen: order.amounts.cashFen,
			status: statuses.cash,
			...(order.wechatOutTradeNo
				? { providerReferenceDigest: digest(order.wechatOutTradeNo) }
				: {}),
			...(statuses.cash === "confirmed"
				? { confirmedAt: order.updatedAt }
				: {}),
			version: (existing?.version ?? 0) + 1,
			createdAt: order.createdAt,
			updatedAt: order.updatedAt,
		});
	}
	const idempotencyKey = `projection:medical_insurance:${order.medicalOrderId}:${order.version}`;
	return {
		aggregate,
		legs,
		event: {
			eventId: stableId("payevt", idempotencyKey),
			aggregateId,
			source: "medical_insurance",
			eventType: "source_projection",
			...(existing ? { previousStatus: existing.status } : {}),
			nextStatus: aggregate.status,
			amountFen: aggregate.totalFen,
			idempotencyKey,
			eventAt: order.updatedAt,
			payloadDigest: digest(
				JSON.stringify({
					aggregate,
					legs,
					payload: {
						status: order.status,
						wechatPaymentState: order.wechatPaymentState ?? "not_started",
						business: aggregate.business,
					},
				}),
			),
		},
	};
}
