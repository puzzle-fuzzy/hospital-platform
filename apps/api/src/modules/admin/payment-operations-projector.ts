import type {
	MedicalInsuranceOrder,
	MedicalInsuranceSettlementContext,
	PaymentAggregate,
	PaymentLeg,
	PaymentOperationEvent,
	PaymentOperationsProjection,
	PaymentOperationsRepository,
	PaymentOrder,
} from "@hospital/domain";
import {
	buildMedicalInsuranceOrderOperationsProjection,
	buildPaymentOrderOperationsProjection,
} from "@hospital/domain";

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

/** 普通 PaymentOrder 的低敏投影构造入口，供 API 和其它组合根复用。 */
export function buildPaymentOrderProjection(
	order: PaymentOrder,
	existing?: PaymentAggregate,
): PaymentOperationsProjection {
	return buildPaymentOrderOperationsProjection(order, existing);
}

export async function projectPaymentOrder(
	repository: PaymentOperationsRepository,
	order: PaymentOrder,
): Promise<PaymentOperationsProjection> {
	const existing = await repository.findAggregateByBusinessKey(
		`payment_order:${order.orderId}`,
	);
	const projection = buildPaymentOrderProjection(order, existing);
	if (!projection.event) throw new Error("Payment operation event is missing");
	return persistProjection(
		repository,
		projection.aggregate,
		projection.legs,
		projection.event,
	);
}

export async function projectMedicalInsuranceOrder(
	repository: PaymentOperationsRepository,
	order: MedicalInsuranceOrder,
	settlement?: MedicalInsuranceSettlementContext,
): Promise<PaymentOperationsProjection | undefined> {
	const existing = await repository.findAggregateByBusinessKey(
		`medical_insurance:${order.medicalOrderId}`,
	);
	const projection = buildMedicalInsuranceOrderOperationsProjection(
		order,
		existing,
		settlement,
	);
	if (!projection) return undefined;
	if (!projection.event) throw new Error("Payment operation event is missing");
	return persistProjection(
		repository,
		projection.aggregate,
		projection.legs,
		projection.event,
	);
}
