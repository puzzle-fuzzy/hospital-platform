import { expect, test } from "bun:test";
import type {
	MedicalInsuranceOrder,
	MedicalInsuranceSettlementContext,
} from "./medical-insurance-order";
import type {
	PaymentAggregate,
	PaymentLeg,
	PaymentOperationEvent,
	PaymentOperationsBackfillQuery,
	PaymentOperationsRepository,
} from "./payment-operations";
import { runPaymentOperationsBackfill } from "./payment-operations-backfill";
import type { PaymentOrder } from "./payment-order";

const firstOrder: PaymentOrder = {
	orderId: "order-backfill-001",
	ownerUserId: "user-backfill-001",
	patientId: "patient-backfill-001",
	idempotencyKey: "outpatient-self-pay:record-001",
	amounts: { totalFen: 1000, insuranceFen: 700, cashFen: 300 },
	state: "completed",
	version: 1,
	createdAt: "2026-09-20T00:00:00.000Z",
	updatedAt: "2026-09-20T00:00:01.000Z",
};

const secondOrder: PaymentOrder = {
	...firstOrder,
	orderId: "order-backfill-002",
	idempotencyKey: "registration-self-pay:appointment-002",
	createdAt: "2026-09-20T00:00:02.000Z",
	updatedAt: "2026-09-20T00:00:03.000Z",
};

const medicalOrder: MedicalInsuranceOrder = {
	medicalOrderId: "medical-backfill-001",
	ownerUserId: "user-backfill-001",
	patientId: "patient-backfill-001",
	businessType: "outpatient",
	orderType: "DiagPay",
	businessId: "record-003",
	idempotencyKey: "medical:record-003",
	medOrgOrd: "med-org-003",
	chrgBchno: "batch-003",
	payOrdId: "pay-ord-003",
	payTokenHash: "hash-003",
	status: "insurance_settled",
	ordStas: "3",
	amounts: {
		totalFen: 1600,
		cashFen: 600,
		personalAccountFen: 0,
		fundFen: 1000,
	},
	setlType: "ALL",
	revsTokenHash: null,
	revsTokenExpiresAt: null,
	lastError: null,
	wechatMixTradeNo: "mix-003",
	wechatOutTradeNo: "out-003",
	wechatPaymentState: "cash_paid",
	version: 2,
	createdAt: "2026-09-20T00:00:01.000Z",
	updatedAt: "2026-09-20T00:00:04.000Z",
};

const medicalWithoutAmounts: MedicalInsuranceOrder = {
	...medicalOrder,
	medicalOrderId: "medical-backfill-002",
	amounts: null,
	version: 1,
	createdAt: "2026-09-20T00:00:03.000Z",
	updatedAt: "2026-09-20T00:00:05.000Z",
};

function createOperationsRepository(): PaymentOperationsRepository & {
	aggregates: Map<string, PaymentAggregate>;
	legs: Map<string, PaymentLeg>;
	events: Map<string, PaymentOperationEvent>;
} {
	const aggregates = new Map<string, PaymentAggregate>();
	const legs = new Map<string, PaymentLeg>();
	const events = new Map<string, PaymentOperationEvent>();
	return {
		aggregates,
		legs,
		events,
		async findAggregateById(aggregateId) {
			return aggregates.get(aggregateId);
		},
		async findAggregateByBusinessKey(businessKey) {
			return [...aggregates.values()].find(
				(aggregate) => aggregate.businessKey === businessKey,
			);
		},
		async upsertAggregate(aggregate, expectedVersion) {
			const current = aggregates.get(aggregate.aggregateId);
			if (
				current &&
				expectedVersion !== undefined &&
				current.version !== expectedVersion
			) {
				throw new Error("aggregate version conflict");
			}
			if (current && current.sourceVersion > aggregate.sourceVersion)
				return current;
			aggregates.set(aggregate.aggregateId, aggregate);
			return aggregate;
		},
		async upsertLeg(leg, expectedVersion) {
			const key = `${leg.aggregateId}:${leg.legType}`;
			const current = legs.get(key);
			if (
				current &&
				expectedVersion !== undefined &&
				current.version !== expectedVersion
			) {
				throw new Error("leg version conflict");
			}
			if (current && current.version >= leg.version) return current;
			legs.set(key, leg);
			return leg;
		},
		async appendEvent(event) {
			const key = `${event.aggregateId}:${event.idempotencyKey}`;
			const current = events.get(key);
			if (current) return current;
			events.set(key, event);
			return event;
		},
		async listLegs(aggregateId) {
			return [...legs.values()].filter(
				(leg) => leg.aggregateId === aggregateId,
			);
		},
		async listEvents(aggregateId) {
			return [...events.values()].filter(
				(event) => event.aggregateId === aggregateId,
			);
		},
	};
}

function page<T extends PaymentOrder | MedicalInsuranceOrder>(
	rows: readonly T[],
	query: PaymentOperationsBackfillQuery,
	id: (row: T) => string,
): readonly T[] {
	return rows
		.filter(
			(row) =>
				(!query.createdFrom || row.createdAt >= query.createdFrom) &&
				(!query.createdTo || row.createdAt < query.createdTo) &&
				(!query.afterCreatedAt ||
					row.createdAt > query.afterCreatedAt ||
					(row.createdAt === query.afterCreatedAt &&
						id(row) > (query.afterSourceOrderId ?? ""))),
		)
		.sort(
			(left, right) =>
				left.createdAt.localeCompare(right.createdAt) ||
				id(left).localeCompare(id(right)),
		)
		.slice(0, query.limit);
}

test("payment operations backfill defaults to dry-run and paginates both sources", async () => {
	const operations = createOperationsRepository();
	const dryRun = await runPaymentOperationsBackfill({
		operations,
		batchSize: 1,
		listPaymentOrders: async (query) =>
			page([firstOrder, secondOrder], query, (row) => row.orderId),
		listMedicalInsuranceOrders: async (query) =>
			page(
				[medicalOrder, medicalWithoutAmounts],
				query,
				(row) => row.medicalOrderId,
			),
		now: () => new Date("2026-09-21T00:00:00.000Z"),
	});

	expect(dryRun.mode).toBe("dry_run");
	expect(dryRun.sources.payment_order).toMatchObject({
		candidates: 2,
		projectable: 2,
		projected: 2,
	});
	expect(dryRun.sources.medical_insurance).toMatchObject({
		candidates: 2,
		projectable: 1,
		skippedMissingAmounts: 1,
	});
	expect(operations.aggregates.size).toBe(0);
});

test("payment operations backfill apply is idempotent and never writes missing medical amounts", async () => {
	const operations = createOperationsRepository();
	const input = {
		operations,
		mode: "apply" as const,
		batchSize: 1,
		listPaymentOrders: async (query: PaymentOperationsBackfillQuery) =>
			page([firstOrder], query, (row) => row.orderId),
		listMedicalInsuranceOrders: async (query: PaymentOperationsBackfillQuery) =>
			page(
				[medicalOrder, medicalWithoutAmounts],
				query,
				(row) => row.medicalOrderId,
			),
	};
	const first = await runPaymentOperationsBackfill(input);
	const replay = await runPaymentOperationsBackfill(input);

	expect(first.sources.payment_order.projected).toBe(1);
	expect(first.sources.medical_insurance.projected).toBe(1);
	expect(first.sources.medical_insurance.skippedMissingAmounts).toBe(1);
	expect(replay.sources.payment_order.unchanged).toBe(1);
	expect(replay.sources.medical_insurance.unchanged).toBe(1);
	expect(replay.sources.medical_insurance.skippedMissingAmounts).toBe(1);
	expect(operations.aggregates.size).toBe(2);
	expect(operations.events.size).toBe(2);
});

test("payment operations backfill repairs an interrupted same-version projection", async () => {
	const operations = createOperationsRepository();
	const input = {
		operations,
		mode: "apply" as const,
		listPaymentOrders: async (query: PaymentOperationsBackfillQuery) =>
			page([firstOrder], query, (row) => row.orderId),
		listMedicalInsuranceOrders: async () => [],
	};

	await runPaymentOperationsBackfill(input);
	operations.legs.clear();
	operations.events.clear();

	const replay = await runPaymentOperationsBackfill(input);

	expect(replay.sources.payment_order.unchanged).toBe(1);
	expect(operations.legs.size).toBe(1);
	expect(operations.events.size).toBe(1);
});

test("same-source-version backfill corrects false cash using successful saved allocations and remains idempotent", async () => {
	const operations = createOperationsRepository();
	const order: MedicalInsuranceOrder = {
		...medicalOrder,
		businessType: "registration",
		orderType: "RegPay",
		amounts: {
			totalFen: 1000,
			cashFen: 200,
			personalAccountFen: 0,
			fundFen: 800,
		},
	};
	const context: MedicalInsuranceSettlementContext = {
		businessId: "record-003",
		hospitalId: "fixture-hospital",
		patientId: "fixture-patient",
		networkRegister: {},
		outNetworkSettleMain: {},
		nationalUpDetailList: [],
		upDetailList: [],
		tradeOrderIds: [],
		postPaymentComponents: [
			{
				componentId: "fixture-medical",
				kind: "medical",
				totalFen: 1000,
				amountFen: 1000,
				payModel: "H5",
				payTypeId: "2",
				state: "succeeded",
				recordCode: "fixture-record",
				attempts: 1,
				updatedAt: order.updatedAt,
				payTypeParams: [
					{ kind: "fund", payTypeId: "2", amountFen: 800 },
					{ kind: "hospital_reduce", payTypeId: "50", amountFen: 200 },
				],
			},
		],
	};
	const input = {
		operations,
		mode: "apply" as const,
		listPaymentOrders: async () => [],
		listMedicalInsuranceOrders: async () => [order],
		loadMedicalInsuranceSettlementContext: async () => context,
	};
	await runPaymentOperationsBackfill(input);
	const aggregate = [...operations.aggregates.values()][0];
	if (!aggregate) throw new Error("Missing test aggregate");
	operations.aggregates.set(aggregate.aggregateId, {
		...aggregate,
		cashFen: 200,
	});
	for (const [key, leg] of operations.legs)
		if (leg.legType === "wechat_cash")
			operations.legs.set(key, {
				...leg,
				amountFen: 200,
				status: "confirmed",
				confirmedAt: order.updatedAt,
			});
	const before = JSON.stringify({ order, context });
	const dry = await runPaymentOperationsBackfill({ ...input, mode: "dry_run" });
	expect(dry.sources.medical_insurance.projected).toBe(1);
	expect(
		(await operations.findAggregateById(aggregate.aggregateId))?.cashFen,
	).toBe(200);
	const applied = await runPaymentOperationsBackfill(input);
	expect(applied.sources.medical_insurance.projected).toBe(1);
	const corrected = await operations.findAggregateById(aggregate.aggregateId);
	if (!corrected) throw new Error("Missing corrected aggregate");
	expect(corrected).toMatchObject({
		totalFen: 1000,
		insuranceFen: 800,
		cashFen: 0,
		sourceVersion: order.version,
	});
	const legs = await operations.listLegs(corrected.aggregateId);
	expect(legs.reduce((sum, leg) => sum + leg.amountFen, 0)).toBe(1000);
	expect(legs.find((leg) => leg.legType === "wechat_cash")).toMatchObject({
		amountFen: 0,
		status: "not_started",
	});
	expect(
		legs.find((leg) => leg.legType === "wechat_cash")?.confirmedAt,
	).toBeUndefined();
	expect(legs.find((leg) => leg.legType === "hospital_reduce")).toMatchObject({
		amountFen: 200,
		status: "confirmed",
	});
	expect(
		(await runPaymentOperationsBackfill(input)).sources.medical_insurance
			.unchanged,
	).toBe(1);
	expect(JSON.stringify({ order, context })).toBe(before);
});
