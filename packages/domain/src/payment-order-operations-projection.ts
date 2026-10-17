import { createHash } from "node:crypto";
import {
	assertValidMedicalInsuranceAmounts,
	type MedicalInsuranceOrder,
	type MedicalInsuranceSettlementContext,
} from "./medical-insurance-order";
import type {
	PaymentAggregate,
	PaymentAggregateBusiness,
	PaymentAggregateHisSyncStatus,
	PaymentAggregateStatus,
	PaymentLeg,
	PaymentLegStatus,
	PaymentLegType,
	PaymentOperationEvent,
	PaymentOperationsProjection,
} from "./payment-operations";
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

/** Amount evidence never applies today's regional discount rule to old orders. */
export function medicalInsuranceOperationsAmounts(
	order: MedicalInsuranceOrder,
	settlement?: MedicalInsuranceSettlementContext,
):
	| {
			insuranceFen: number;
			wechatCashFen: number;
			hospitalPartFen: number;
			hospitalReduceFen: number;
			unallocatedFen: number;
			proven: boolean;
	  }
	| undefined {
	if (!order.amounts) return undefined;
	const amounts = assertValidMedicalInsuranceAmounts(order.amounts);
	const insuranceFen = amounts.fundFen + amounts.personalAccountFen;
	const hospitalPartFen = amounts.hospitalPartFen ?? 0;
	const otherPaymentFen = amounts.otherPaymentFen ?? 0;
	if (hospitalPartFen > otherPaymentFen)
		throw new Error("Hospital liability exceeds other payment amount");
	const unknown = {
		insuranceFen,
		wechatCashFen: 0,
		hospitalPartFen,
		hospitalReduceFen: 0,
		unallocatedFen: amounts.cashFen + otherPaymentFen - hospitalPartFen,
		proven: amounts.cashFen === 0 && otherPaymentFen === hospitalPartFen,
	};
	const components = settlement?.postPaymentComponents ?? [];
	if (components.length === 0) return unknown;
	// A succeeded .2 component proves the saved allocation, not a WeChat debit.
	// Cash confirmation is independently gated by the order's payment state below.
	const ids = new Set<string>();
	const totals = {
		fund: 0,
		personal_account: 0,
		wechat_cash: 0,
		hospital_reduce: 0,
	};
	for (const component of components) {
		if (component.state !== "succeeded") return unknown;
		if (ids.has(component.componentId)) return unknown;
		ids.add(component.componentId);
		const parameters =
			component.kind === "combined" || component.kind === "medical"
				? component.payTypeParams
				: [component];
		if (!parameters?.length) return unknown;
		let sum = 0;
		for (const parameter of parameters) {
			if (!Number.isSafeInteger(parameter.amountFen) || parameter.amountFen < 0)
				return unknown;
			if (
				parameter.kind !== "fund" &&
				parameter.kind !== "personal_account" &&
				parameter.kind !== "wechat_cash" &&
				parameter.kind !== "hospital_reduce"
			)
				return unknown;
			const expected = {
				fund: "2",
				personal_account: "5",
				hospital_reduce: "50",
			};
			if (
				parameter.kind !== "wechat_cash" &&
				parameter.payTypeId !== expected[parameter.kind]
			)
				return unknown;
			if (
				parameter.kind === "wechat_cash" &&
				!["3", "31", "5027", "5031", "5032", "5033"].includes(
					parameter.payTypeId,
				)
			)
				return unknown;
			totals[parameter.kind] += parameter.amountFen;
			sum += parameter.amountFen;
		}
		if (
			!Number.isSafeInteger(sum) ||
			sum !== component.amountFen ||
			component.totalFen !== amounts.totalFen
		)
			return unknown;
	}
	const reduction = totals.hospital_reduce - hospitalPartFen;
	if (
		Object.values(totals).some((value) => !Number.isSafeInteger(value)) ||
		totals.fund !== amounts.fundFen ||
		totals.personal_account !== amounts.personalAccountFen ||
		otherPaymentFen !== hospitalPartFen ||
		reduction < 0 ||
		totals.wechat_cash + reduction !== amounts.cashFen
	)
		return unknown;
	return {
		insuranceFen,
		wechatCashFen: totals.wechat_cash,
		hospitalPartFen,
		hospitalReduceFen: reduction,
		unallocatedFen: 0,
		proven: true,
	};
}

function medicalAggregateStatus(
	order: MedicalInsuranceOrder,
	amounts: NonNullable<ReturnType<typeof medicalInsuranceOperationsAmounts>>,
): PaymentAggregateStatus {
	if (
		order.status === "manual_review" ||
		order.status === "awaiting_confirmation"
	)
		return "manual_review";
	if (order.status === "failed" || order.status === "cancelled")
		return "failed";
	if (order.status === "insurance_settled") {
		if (!amounts.proven || amounts.unallocatedFen > 0) return "manual_review";
		return amounts.wechatCashFen === 0 ||
			order.wechatPaymentState === "cash_paid"
			? "paid"
			: "pending";
	}
	return order.status === "created" ? "created" : "pending";
}

function medicalHisSyncStatus(
	order: MedicalInsuranceOrder,
	amounts: NonNullable<ReturnType<typeof medicalInsuranceOperationsAmounts>>,
	settlement?: MedicalInsuranceSettlementContext,
): PaymentAggregateHisSyncStatus {
	if (order.status === "failed" || order.status === "cancelled")
		return "not_required";
	if (
		order.status !== "insurance_settled" ||
		medicalAggregateStatus(order, amounts) !== "paid" ||
		!settlement?.postPaymentCompletedAt
	)
		return "pending";
	const medical = settlement.settlementCompletion;
	const selfPay = settlement.selfPaySettlementCompletion;
	// A successful leg cannot hide another saved failed/unknown completion.
	if (
		[medical, selfPay].some(
			(completion) => completion && completion.status !== "succeeded",
		)
	)
		return "pending";
	const separateCash = settlement.postPaymentComponents?.some(
		(component) => component.kind === "wechat_cash" && component.amountFen > 0,
	);
	if (!separateCash)
		return medical?.status === "succeeded" ? "succeeded" : "pending";
	if (settlement.postPaymentPlanVersion === "sequenced-v1") {
		// New mixed plans perform their unique final .5 on the cash leg.
		if (selfPay?.status === "succeeded") return "succeeded";
		// An explicitly completed old .5 may be reused only after .29/.15;
		// this is the worker's persisted migration path, never a second .5.
		return medical?.status === "succeeded" &&
			settlement.selfPayThirdPartyWriteback?.status === "succeeded" &&
			settlement.selfPayPaymentNotify?.status === "succeeded"
			? "succeeded"
			: "pending";
	}
	// Legacy split plans require both persisted final completions.
	return medical?.status === "succeeded" && selfPay?.status === "succeeded"
		? "succeeded"
		: "pending";
}

/** 医保订单的确定性、低敏运营台投影构造器。原 ownPayAmt 不等于微信实付。 */
export function buildMedicalInsuranceOrderOperationsProjection(
	order: MedicalInsuranceOrder,
	existing?: PaymentAggregate,
	settlement?: MedicalInsuranceSettlementContext,
): PaymentOperationsProjection | undefined {
	const amounts = medicalInsuranceOperationsAmounts(order, settlement);
	if (!amounts || !order.amounts) return undefined;
	const businessKey = `medical_insurance:${order.medicalOrderId}`;
	const aggregateId = stableId("payagg", businessKey);
	const aggregate: PaymentAggregate = {
		aggregateId,
		ownerUserId: order.ownerUserId,
		patientId: order.patientId,
		business: medicalBusiness(order),
		businessKey,
		businessId: order.businessId ?? order.medicalOrderId,
		totalFen: order.amounts.totalFen,
		insuranceFen: amounts.insuranceFen,
		cashFen: amounts.wechatCashFen,
		status: medicalAggregateStatus(order, amounts),
		hisSyncStatus: medicalHisSyncStatus(order, amounts, settlement),
		sourceVersion: order.version,
		version: (existing?.version ?? 0) + 1,
		createdAt: order.createdAt,
		updatedAt: order.updatedAt,
	};
	const settled = order.status === "insurance_settled";
	const baseStatus: PaymentLegStatus =
		order.status === "failed" || order.status === "cancelled"
			? "failed"
			: order.status === "manual_review" ||
					order.status === "awaiting_confirmation"
				? "manual_review"
				: order.status === "created"
					? "not_started"
					: "pending";
	// Keep zero-valued legs so a corrected projection clears old false cash/unknown legs.
	const legs = (
		[
			["medical_insurance", amounts.insuranceFen],
			["wechat_cash", amounts.wechatCashFen],
			["hospital_part", amounts.hospitalPartFen],
			["hospital_reduce", amounts.hospitalReduceFen],
			["unallocated", amounts.unallocatedFen],
		] as const
	).map(([legType, amountFen]): PaymentLeg => {
		const status: PaymentLegStatus =
			amountFen === 0
				? "not_started"
				: legType === "unallocated"
					? "manual_review"
					: legType === "wechat_cash"
						? order.wechatPaymentState === "cash_paid" && amounts.proven
							? "confirmed"
							: order.wechatPaymentState === "failed"
								? "failed"
								: baseStatus
						: settled && (legType === "medical_insurance" || amounts.proven)
							? "confirmed"
							: baseStatus;
		const reference =
			legType === "wechat_cash"
				? order.wechatOutTradeNo
				: legType === "medical_insurance"
					? (order.payOrdId ?? order.medOrgOrd)
					: undefined;
		return {
			legId: stableId("payleg", `${aggregateId}:${legType}`),
			aggregateId,
			legType,
			source:
				legType === "wechat_cash"
					? "wechat_pay"
					: legType === "medical_insurance"
						? "medical_insurance"
						: "platform",
			sourceOrderId: order.medicalOrderId,
			amountFen,
			status,
			...(reference ? { providerReferenceDigest: digest(reference) } : {}),
			// Source updatedAt is not a payment timestamp; unknown exact times stay absent.
			version: (existing?.version ?? 0) + 1,
			createdAt: order.createdAt,
			updatedAt: order.updatedAt,
		};
	});
	if (legs.reduce((sum, leg) => sum + leg.amountFen, 0) !== aggregate.totalFen)
		throw new Error("Medical operations projection amount mismatch");
	const idempotencyKey = `projection:medical_insurance:v2:${order.medicalOrderId}:${order.version}:${digest(JSON.stringify(amounts)).slice(0, 16)}`;
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
					amounts,
					status: order.status,
					wechatPaymentState: order.wechatPaymentState,
				}),
			),
		},
	};
}
