import { createHash } from "node:crypto";
import type {
	MedicalInsuranceOrder,
	PaymentAggregate,
	PaymentAggregateBusiness,
	PaymentAggregateStatus,
	PaymentLeg,
	PaymentLegStatus,
	PaymentLegType,
	PaymentOperationEvent,
	PaymentOperationsRepository,
	PaymentOrder,
} from "@hospital/domain";

export type PaymentOperationsProjection = {
	aggregate: PaymentAggregate;
	legs: readonly PaymentLeg[];
	event?: PaymentOperationEvent;
};

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

function medicalBusiness(
	order: MedicalInsuranceOrder,
): PaymentAggregateBusiness {
	return order.businessType === "outpatient" || order.orderType === "DiagPay"
		? "outpatient"
		: "registration";
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

function makeAggregate(input: {
	aggregateId: string;
	ownerUserId: string;
	patientId: string;
	business: PaymentAggregateBusiness;
	businessKey: string;
	businessId: string;
	totalFen: number;
	insuranceFen: number;
	cashFen: number;
	status: PaymentAggregateStatus;
	hisSyncStatus: PaymentAggregate["hisSyncStatus"];
	sourceVersion: number;
	version: number;
	createdAt: string;
	updatedAt: string;
}): PaymentAggregate {
	return input;
}

function makeLeg(input: {
	aggregateId: string;
	legType: PaymentLegType;
	source: PaymentLeg["source"];
	sourceOrderId: string;
	amountFen: number;
	status: PaymentLegStatus;
	providerReferenceDigest?: string;
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
	source: PaymentOperationEvent["source"];
	sourceOrderId: string;
	sourceVersion: number;
	previousStatus?: string;
	payload: Record<string, unknown>;
	eventAt: string;
}): PaymentOperationEvent {
	const idempotencyKey = `projection:${input.source}:${input.sourceOrderId}:${input.sourceVersion}`;
	return {
		eventId: stableId("payevt", idempotencyKey),
		aggregateId: input.aggregate.aggregateId,
		source: input.source,
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

async function persistProjection(
	repository: PaymentOperationsRepository,
	aggregate: PaymentAggregate,
	legs: readonly PaymentLeg[],
	event: PaymentOperationEvent,
): Promise<PaymentOperationsProjection> {
	const existing = await repository.findAggregateById(aggregate.aggregateId);
	if (existing && existing.sourceVersion >= aggregate.sourceVersion) {
		return {
			aggregate: existing,
			legs: await repository.listLegs(existing.aggregateId),
		};
	}
	const storedAggregate = await repository.upsertAggregate(
		aggregate,
		existing?.version,
	);
	const existingLegs = new Map(
		(await repository.listLegs(storedAggregate.aggregateId)).map((leg) => [
			leg.legType,
			leg,
		]),
	);
	const storedLegs: PaymentLeg[] = [];
	for (const leg of legs) {
		storedLegs.push(
			await repository.upsertLeg(leg, existingLegs.get(leg.legType)?.version),
		);
	}
	const storedEvent = await repository.appendEvent(event);
	return { aggregate: storedAggregate, legs: storedLegs, event: storedEvent };
}

export async function projectPaymentOrder(
	repository: PaymentOperationsRepository,
	order: PaymentOrder,
): Promise<PaymentOperationsProjection> {
	const businessKey = `payment_order:${order.orderId}`;
	const aggregateId = stableId("payagg", businessKey);
	const existing = await repository.findAggregateById(aggregateId);
	const aggregate = makeAggregate({
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
	});
	const leg = makeLeg({
		aggregateId,
		legType: "wechat_cash",
		source: "payment_order",
		sourceOrderId: order.orderId,
		amountFen: order.amounts.cashFen,
		status: paymentLegStatus(order.state),
		...(paymentLegStatus(order.state) === "confirmed"
			? { confirmedAt: order.updatedAt }
			: {}),
		version: (existing?.version ?? 0) + 1,
		createdAt: order.createdAt,
		updatedAt: order.updatedAt,
	});
	return persistProjection(
		repository,
		aggregate,
		[leg],
		makeEvent({
			aggregate,
			legs: [leg],
			source: "payment_order",
			sourceOrderId: order.orderId,
			sourceVersion: order.version,
			...(existing ? { previousStatus: existing.status } : {}),
			payload: { state: order.state, business: aggregate.business },
			eventAt: order.updatedAt,
		}),
	);
}

export async function projectMedicalInsuranceOrder(
	repository: PaymentOperationsRepository,
	order: MedicalInsuranceOrder,
): Promise<PaymentOperationsProjection | undefined> {
	if (!order.amounts) return undefined;
	const businessKey = `medical_insurance:${order.medicalOrderId}`;
	const aggregateId = stableId("payagg", businessKey);
	const existing = await repository.findAggregateById(aggregateId);
	const insuranceFen = order.amounts.totalFen - order.amounts.cashFen;
	const aggregate = makeAggregate({
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
	});
	const statuses = medicalLegStatus(order);
	const insuranceLeg = makeLeg({
		aggregateId,
		legType: "medical_insurance",
		source: "medical_insurance",
		sourceOrderId: order.medicalOrderId,
		amountFen: insuranceFen,
		status: statuses.insurance,
		...(order.payOrdId || order.medOrgOrd
			? { providerReferenceDigest: digest(order.payOrdId ?? order.medOrgOrd) }
			: {}),
		...(statuses.insurance === "confirmed"
			? { confirmedAt: order.updatedAt }
			: {}),
		version: (existing?.version ?? 0) + 1,
		createdAt: order.createdAt,
		updatedAt: order.updatedAt,
	});
	const legs = [insuranceLeg];
	if (order.amounts.cashFen > 0) {
		legs.push(
			makeLeg({
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
			}),
		);
	}
	return persistProjection(
		repository,
		aggregate,
		legs,
		makeEvent({
			aggregate,
			legs,
			source: "medical_insurance",
			sourceOrderId: order.medicalOrderId,
			sourceVersion: order.version,
			...(existing ? { previousStatus: existing.status } : {}),
			payload: {
				status: order.status,
				wechatPaymentState: order.wechatPaymentState ?? "not_started",
				business: aggregate.business,
			},
			eventAt: order.updatedAt,
		}),
	);
}
