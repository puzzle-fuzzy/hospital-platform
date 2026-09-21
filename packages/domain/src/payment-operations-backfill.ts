import type { MedicalInsuranceOrder } from "./medical-insurance-order";
import type {
	PaymentOperationsBackfillQuery,
	PaymentOperationsRepository,
} from "./payment-operations";
import type { PaymentOrder } from "./payment-order";
import {
	buildMedicalInsuranceOrderOperationsProjection,
	buildPaymentOrderOperationsProjection,
} from "./payment-order-operations-projection";

export type PaymentOperationsBackfillSource =
	| "payment_order"
	| "medical_insurance";

export type PaymentOperationsBackfillFailure = {
	source: PaymentOperationsBackfillSource;
	sourceOrderId: string;
	reason: string;
};

export type PaymentOperationsBackfillReport = {
	mode: "dry_run" | "apply";
	startedAt: string;
	finishedAt: string;
	filters: {
		createdFrom?: string;
		createdTo?: string;
		batchSize: number;
		sources: readonly PaymentOperationsBackfillSource[];
	};
	sources: Record<
		PaymentOperationsBackfillSource,
		{
			candidates: number;
			projectable: number;
			projected: number;
			unchanged: number;
			stale: number;
			skippedMissingAmounts: number;
			failed: number;
		}
	>;
	failures: readonly PaymentOperationsBackfillFailure[];
};

export type PaymentOperationsBackfillInput = {
	operations: PaymentOperationsRepository;
	listPaymentOrders: (
		query: PaymentOperationsBackfillQuery,
	) => Promise<readonly PaymentOrder[]>;
	listMedicalInsuranceOrders: (
		query: PaymentOperationsBackfillQuery,
	) => Promise<readonly MedicalInsuranceOrder[]>;
	mode?: "dry_run" | "apply";
	createdFrom?: string;
	createdTo?: string;
	batchSize?: number;
	sources?: readonly PaymentOperationsBackfillSource[];
	now?: () => Date;
};

const DEFAULT_BATCH_SIZE = 250;
const MAX_BATCH_SIZE = 1_000;
const MAX_REPORTED_FAILURES = 100;

function makeSourceReport() {
	return {
		candidates: 0,
		projectable: 0,
		projected: 0,
		unchanged: 0,
		stale: 0,
		skippedMissingAmounts: 0,
		failed: 0,
	};
}

function assertBatchSize(value: number): number {
	if (!Number.isSafeInteger(value) || value < 1 || value > MAX_BATCH_SIZE) {
		throw new Error(
			`Payment operations backfill batchSize must be 1-${MAX_BATCH_SIZE}`,
		);
	}
	return value;
}

function cursorAfter(
	rows: readonly (PaymentOrder | MedicalInsuranceOrder)[],
): { afterCreatedAt: string; afterSourceOrderId: string } | undefined {
	const last = rows.at(-1);
	if (!last) return undefined;
	return {
		afterCreatedAt: last.createdAt,
		afterSourceOrderId: "orderId" in last ? last.orderId : last.medicalOrderId,
	};
}

function compareCursor(
	left: { createdAt: string; sourceOrderId: string },
	right: { createdAt: string; sourceOrderId: string },
): number {
	return (
		left.createdAt.localeCompare(right.createdAt) ||
		left.sourceOrderId.localeCompare(right.sourceOrderId)
	);
}

function sourceId(order: PaymentOrder | MedicalInsuranceOrder): string {
	return "orderId" in order ? order.orderId : order.medicalOrderId;
}

async function projectOrder(
	operations: PaymentOperationsRepository,
	source: PaymentOperationsBackfillSource,
	order: PaymentOrder | MedicalInsuranceOrder,
	mode: "dry_run" | "apply",
): Promise<"projected" | "unchanged" | "stale" | "missing_amounts"> {
	const businessKey =
		source === "payment_order"
			? `payment_order:${(order as PaymentOrder).orderId}`
			: `medical_insurance:${(order as MedicalInsuranceOrder).medicalOrderId}`;
	const existing = await operations.findAggregateByBusinessKey(businessKey);
	if (existing && existing.sourceVersion >= order.version) {
		// 同版本重跑时先修复可能在上次进程中断时留下的缺腿/缺事件，
		// 不能仅因为聚合单已存在就把不完整投影永久判为 unchanged。
		if (existing.sourceVersion === order.version && mode === "apply") {
			const projection =
				source === "payment_order"
					? buildPaymentOrderOperationsProjection(
							order as PaymentOrder,
							existing,
						)
					: buildMedicalInsuranceOrderOperationsProjection(
							order as MedicalInsuranceOrder,
							existing,
						);
			if (projection) {
				const existingLegs = new Map(
					(await operations.listLegs(existing.aggregateId)).map((leg) => [
						leg.legType,
						leg,
					]),
				);
				for (const leg of projection.legs) {
					const current = existingLegs.get(leg.legType);
					if (!current || current.version < leg.version) {
						await operations.upsertLeg(leg, current?.version);
					}
				}
				const existingEvents = await operations.listEvents(existing.aggregateId);
				if (
					projection.event &&
					!existingEvents.some(
						(event) =>
							event.idempotencyKey === projection.event?.idempotencyKey,
					)
				) {
					await operations.appendEvent(projection.event);
				}
			}
		}
		return existing.sourceVersion === order.version ? "unchanged" : "stale";
	}

	const projection =
		source === "payment_order"
			? buildPaymentOrderOperationsProjection(order as PaymentOrder, existing)
			: buildMedicalInsuranceOrderOperationsProjection(
					order as MedicalInsuranceOrder,
					existing,
				);
	if (!projection) return "missing_amounts";
	if (mode === "dry_run") return "projected";

	const storedAggregate = await operations.upsertAggregate(
		projection.aggregate,
		existing?.version,
	);
	const existingLegs = new Map(
		(await operations.listLegs(storedAggregate.aggregateId)).map((leg) => [
			leg.legType,
			leg,
		]),
	);
	for (const leg of projection.legs) {
		await operations.upsertLeg(leg, existingLegs.get(leg.legType)?.version);
	}
	if (projection.event) await operations.appendEvent(projection.event);
	return "projected";
}

async function processSource(
	input: PaymentOperationsBackfillInput,
	source: PaymentOperationsBackfillSource,
	report: PaymentOperationsBackfillReport["sources"][PaymentOperationsBackfillSource],
	failures: PaymentOperationsBackfillFailure[],
): Promise<void> {
	const batchSize = assertBatchSize(input.batchSize ?? DEFAULT_BATCH_SIZE);
	let cursor:
		| { afterCreatedAt: string; afterSourceOrderId: string }
		| undefined;
	let previousCursor: { createdAt: string; sourceOrderId: string } | undefined;

	while (true) {
		const query: PaymentOperationsBackfillQuery = {
			limit: batchSize,
			...(input.createdFrom ? { createdFrom: input.createdFrom } : {}),
			...(input.createdTo ? { createdTo: input.createdTo } : {}),
			...(cursor ?? {}),
		};
		const rows =
			source === "payment_order"
				? await input.listPaymentOrders(query)
				: await input.listMedicalInsuranceOrders(query);
		if (rows.length === 0) break;
		if (rows.length > batchSize) {
			throw new Error(`${source} backfill source returned too many rows`);
		}

		for (const order of rows) {
			const currentCursor = {
				createdAt: order.createdAt,
				sourceOrderId: sourceId(order),
			};
			if (previousCursor && compareCursor(currentCursor, previousCursor) <= 0) {
				throw new Error(
					`${source} backfill source cursor is not strictly increasing`,
				);
			}
			previousCursor = currentCursor;
			report.candidates += 1;
			try {
				const result = await projectOrder(
					input.operations,
					source,
					order,
					input.mode ?? "dry_run",
				);
				if (result === "missing_amounts") {
					report.skippedMissingAmounts += 1;
				} else {
					report.projectable += 1;
					if (result === "projected") report.projected += 1;
					if (result === "unchanged") report.unchanged += 1;
					if (result === "stale") report.stale += 1;
				}
			} catch (error) {
				report.failed += 1;
				if (failures.length < MAX_REPORTED_FAILURES) {
					failures.push({
						source,
						sourceOrderId: sourceId(order),
						reason: error instanceof Error ? error.name : "UnknownError",
					});
				}
			}
		}

		if (rows.length < batchSize) break;
		const nextCursor = cursorAfter(rows);
		if (!nextCursor) break;
		cursor = nextCursor;
	}
}

/**
 * 运行平台支付账本历史回填。
 *
 * 默认 dry-run；apply 只把来源订单重新投影到低敏 aggregate/leg/event，
 * 不调用 HIS、医保或微信，也不修改来源订单、退费记录或任何支付终态。
 */
export async function runPaymentOperationsBackfill(
	input: PaymentOperationsBackfillInput,
): Promise<PaymentOperationsBackfillReport> {
	const mode = input.mode ?? "dry_run";
	const batchSize = assertBatchSize(input.batchSize ?? DEFAULT_BATCH_SIZE);
	const sources = [
		...(input.sources ?? ["payment_order", "medical_insurance"]),
	].filter((source, index, all) => all.indexOf(source) === index);
	if (sources.length === 0) {
		throw new Error("At least one backfill source is required");
	}
	const invalidSource = sources.find(
		(source) => source !== "payment_order" && source !== "medical_insurance",
	);
	if (invalidSource)
		throw new Error(`Unknown backfill source: ${invalidSource}`);

	const now = input.now ?? (() => new Date());
	const startedAt = now().toISOString();
	const report: PaymentOperationsBackfillReport = {
		mode,
		startedAt,
		finishedAt: startedAt,
		filters: {
			...(input.createdFrom ? { createdFrom: input.createdFrom } : {}),
			...(input.createdTo ? { createdTo: input.createdTo } : {}),
			batchSize,
			sources,
		},
		sources: {
			payment_order: makeSourceReport(),
			medical_insurance: makeSourceReport(),
		},
		failures: [],
	};
	const failures: PaymentOperationsBackfillFailure[] = [];
	for (const source of sources) {
		await processSource(input, source, report.sources[source], failures);
	}
	report.finishedAt = now().toISOString();
	report.failures = failures;
	return report;
}
