import { expect, test } from "bun:test";
import type {
	MedicalInsuranceGateway,
	PaymentOrder,
	PaymentOrderRepository,
	MedicalInsuranceSettlementEvidence,
} from "@hospital/domain";
import { PaymentOrderService } from "@hospital/domain";
import {
	MedicalInsuranceReconciliationWorker,
	type MedicalInsuranceQueryTask,
	type MedicalInsuranceQueryTaskRepository,
} from "./medical-insurance-reconciliation-worker";

const now = new Date("2026-09-02T00:00:00.000Z");
const order: PaymentOrder = {
	orderId: "order-medical-worker-001",
	ownerUserId: "user-medical-worker-001",
	patientId: "patient-medical-worker-001",
	idempotencyKey: "order-medical-worker-key-001",
	amounts: { totalFen: 700, insuranceFen: 700, cashFen: 0 },
	state: "insurance_submitted",
	version: 4,
	createdAt: now.toISOString(),
	updatedAt: now.toISOString(),
};

function createOrderRepository(seed: PaymentOrder): {
	repository: PaymentOrderRepository;
	read(): PaymentOrder;
} {
	let current = seed;
	const repository: PaymentOrderRepository = {
		async findById(orderId) {
			return current.orderId === orderId ? current : undefined;
		},
		async findByOwnerAndIdempotencyKey() {
			return undefined;
		},
		async findByOwnerAndId() {
			return undefined;
		},
		async insert() {
			throw new Error("insert is not used by medical reconciliation tests");
		},
		async update(updated, expectedVersion) {
			if (current.version !== expectedVersion)
				throw new Error("version conflict");
			current = updated;
			return current;
		},
	};
	return { repository, read: () => current };
}

function createTaskRepository(seed: MedicalInsuranceQueryTask): {
	repository: MedicalInsuranceQueryTaskRepository;
	read(): MedicalInsuranceQueryTask;
} {
	let current = seed;
	const repository: MedicalInsuranceQueryTaskRepository = {
		async insert(task) {
			if (current.taskId !== task.taskId) {
				current = task;
				return current;
			}
			if (current.medicalOrderId !== task.medicalOrderId) {
				throw new Error("task idempotency payload changed");
			}
			return current;
		},
		async claimDueForQuery(queryNow, limit, leaseMs) {
			if (
				limit <= 0 ||
				current.status !== "pending" ||
				new Date(current.nextAttemptAt).getTime() > queryNow.getTime() ||
				(current.claimedUntil &&
					new Date(current.claimedUntil).getTime() > queryNow.getTime())
			) {
				return [];
			}
			current = {
				...current,
				version: current.version + 1,
				status: "in_progress",
				claimedUntil: new Date(queryNow.getTime() + leaseMs).toISOString(),
				updatedAt: queryNow.toISOString(),
			};
			return [current];
		},
		async update(updated, expectedVersion) {
			if (current.version !== expectedVersion) throw new Error("task conflict");
			current = updated;
			return current;
		},
	};
	return { repository, read: () => current };
}

function gatewayFor(
	query: (
		input: { orderId: string },
		context: { traceId: string; idempotencyKey: string },
	) => Promise<MedicalInsuranceSettlementEvidence>,
): MedicalInsuranceGateway {
	return {
		authorize: async () => {
			throw new Error("authorize is not used by reconciliation tests");
		},
		uploadFees: async () => {
			throw new Error("uploadFees is not used by reconciliation tests");
		},
		settle: async () => {
			throw new Error("settle is not used by reconciliation tests");
		},
		query,
	};
}

function task(): MedicalInsuranceQueryTask {
	return {
		taskId: "medical-query-task-001",
		medicalOrderId: order.orderId,
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
	};
}

test("medical reconciliation worker retries 6301 intermediate evidence", async () => {
	const orders = createOrderRepository(order);
	const tasks = createTaskRepository(task());
	const worker = new MedicalInsuranceReconciliationWorker({
		tasks: tasks.repository,
		orders: new PaymentOrderService({ orders: orders.repository }),
		medicalInsurance: gatewayFor(async () => ({
			state: "awaiting_confirmation",
			amounts: order.amounts,
			trace: {
				provider: "legacy-fsi",
				operation: "legacy-fsi.6301",
				requestId: "medical-worker-query-001",
			},
			source: "6301",
			providerStatus: "1",
			finality: "processing",
			authoritative: false,
		})),
	});

	await expect(worker.runOnce(now)).resolves.toBe("retry_scheduled");
	expect(orders.read().state).toBe("awaiting_confirmation");
	expect(tasks.read()).toMatchObject({
		status: "pending",
		attempts: 1,
		nextAttemptAt: "2026-09-02T00:00:15.000Z",
	});
});

test("medical reconciliation worker resolves only Yunhealth/HIS paid evidence", async () => {
	const orders = createOrderRepository({
		...order,
		state: "awaiting_confirmation",
		version: 5,
	});
	const tasks = createTaskRepository({
		...task(),
		version: 2,
		attempts: 1,
		nextAttemptAt: "2026-09-02T00:00:15.000Z",
	});
	const worker = new MedicalInsuranceReconciliationWorker({
		tasks: tasks.repository,
		orders: new PaymentOrderService({ orders: orders.repository }),
		medicalInsurance: gatewayFor(async () => ({
			state: "insurance_settled",
			amounts: order.amounts,
			trace: {
				provider: "yunhealth",
				operation: "yunhealth.registration.complete",
				requestId: "yunhealth-worker-complete-001",
			},
			source: "yunhealth",
			providerStatus: "isSettle=1",
			finality: "paid",
			authoritative: true,
		})),
	});

	await expect(
		worker.runOnce(new Date("2026-09-02T00:00:16.000Z")),
	).resolves.toBe("reconciled");
	expect(orders.read().state).toBe("insurance_settled");
	expect(tasks.read()).toMatchObject({
		status: "completed",
		attempts: 2,
	});
});
