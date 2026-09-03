import { expect, test } from "bun:test";
import type {
	MedicalInsuranceOrder,
	MedicalInsuranceQueryTask,
	MedicalInsuranceSettlementEvidence,
} from "@hospital/domain";
import {
	createInMemoryMedicalInsuranceOrderRepository,
	createInMemoryMedicalInsuranceQueryTaskRepository,
} from "@hospital/persistence";
import { MedicalInsuranceOrderReconciliationWorker } from "./medical-insurance-order-reconciliation-worker";

const now = new Date("2026-09-03T00:00:00.000Z");

function order(
	overrides: Partial<MedicalInsuranceOrder> = {},
): MedicalInsuranceOrder {
	return {
		medicalOrderId: "medical-order-worker-001",
		ownerUserId: "user-worker-001",
		patientId: "patient-worker-001",
		appointmentId: "appointment-worker-001",
		authorizationId: "authorization-worker-001",
		feeUploadId: "credential-worker-001",
		idempotencyKey: "medical-order-worker-idempotency",
		medOrgOrd: "medical-order-worker-001",
		chrgBchno: "charge-worker-001",
		payOrdId: "pay-order-worker-001",
		payTokenHash: "a".repeat(64),
		mdtrtId: "mdtrt-worker-001",
		acctUsedFlag: "1",
		status: "order_placed",
		ordStas: "1",
		amounts: {
			totalFen: 100,
			cashFen: 20,
			personalAccountFen: 30,
			fundFen: 50,
		},
		setlType: "CASH",
		revsTokenHash: null,
		revsTokenExpiresAt: null,
		lastError: null,
		version: 1,
		createdAt: now.toISOString(),
		updatedAt: now.toISOString(),
		...overrides,
	};
}

function task(
	overrides: Partial<MedicalInsuranceQueryTask> = {},
): MedicalInsuranceQueryTask {
	return {
		taskId: "medical-order-worker-001",
		medicalOrderId: "medical-order-worker-001",
		status: "pending",
		version: 1,
		attempts: 0,
		maxAttempts: 12,
		nextAttemptAt: now.toISOString(),
		claimedUntil: null,
		terminalOrdStas: null,
		lastErrorCode: null,
		createdAt: now.toISOString(),
		updatedAt: now.toISOString(),
		...overrides,
	};
}

function evidence(
	overrides: Partial<MedicalInsuranceSettlementEvidence> = {},
): MedicalInsuranceSettlementEvidence {
	return {
		state: "awaiting_confirmation",
		amounts: { totalFen: 100, insuranceFen: 80, cashFen: 20 },
		trace: {
			provider: "medical-insurance",
			operation: "medical-insurance.6301",
			requestId: "medical-query-worker-001",
		},
		source: "6301",
		providerStatus: "1",
		finality: "processing",
		authoritative: false,
		...overrides,
	};
}

test("new medical order worker retries non-terminal 6301 evidence", async () => {
	const orders = createInMemoryMedicalInsuranceOrderRepository();
	await orders.insert(order());
	const tasks = createInMemoryMedicalInsuranceQueryTaskRepository([task()]);
	let receivedOwner: string | undefined;
	const worker = new MedicalInsuranceOrderReconciliationWorker({
		tasks,
		orders,
		medicalInsurance: {
			query: async (input) => {
				receivedOwner = input.ownerUserId;
				return evidence();
			},
		},
	});

	expect(await worker.runOnce(now)).toBe("retry_scheduled");
	expect(receivedOwner).toBe("user-worker-001");
	expect(
		await orders.findByMedicalOrderId("medical-order-worker-001"),
	).toMatchObject({
		status: "awaiting_confirmation",
		amounts: order().amounts,
	});

	// The task repository is intentionally exercised through its public claim path;
	// an immediate second run must respect the backoff written by the worker.
	expect(await worker.runOnce(now)).toBe("idle");
});

test("new medical order worker completes only authoritative Yunhealth evidence", async () => {
	const orders = createInMemoryMedicalInsuranceOrderRepository();
	await orders.insert(
		order({
			status: "awaiting_confirmation",
			version: 2,
			amounts: {
				totalFen: 100,
				cashFen: 0,
				personalAccountFen: 30,
				fundFen: 70,
			},
			setlType: "ALL",
		}),
	);
	const tasks = createInMemoryMedicalInsuranceQueryTaskRepository([
		task({ version: 2, attempts: 1, nextAttemptAt: now.toISOString() }),
	]);
	const worker = new MedicalInsuranceOrderReconciliationWorker({
		tasks,
		orders,
		medicalInsurance: {
			query: async () =>
				evidence({
					amounts: { totalFen: 100, insuranceFen: 100, cashFen: 0 },
					state: "insurance_settled",
					source: "yunhealth",
					providerStatus: "isSettle=1",
					finality: "paid",
					authoritative: true,
				}),
		},
	});

	expect(await worker.runOnce(now)).toBe("reconciled");
	expect(
		await orders.findByMedicalOrderId("medical-order-worker-001"),
	).toMatchObject({
		status: "insurance_settled",
		version: 3,
	});
});

test("new medical order worker does not query an order already in manual review", async () => {
	const orders = createInMemoryMedicalInsuranceOrderRepository();
	await orders.insert(order({ status: "manual_review" }));
	const tasks = createInMemoryMedicalInsuranceQueryTaskRepository([task()]);
	let queryCalls = 0;
	const worker = new MedicalInsuranceOrderReconciliationWorker({
		tasks,
		orders,
		medicalInsurance: {
			query: async () => {
				queryCalls += 1;
				return evidence();
			},
		},
	});

	expect(await worker.runOnce(now)).toBe("manual_review");
	expect(queryCalls).toBe(0);
	const [claimedAgain] = await tasks.claimDueForQuery(
		new Date(now.getTime() + 60_000),
		1,
		60_000,
	);
	expect(claimedAgain).toBeUndefined();
});
