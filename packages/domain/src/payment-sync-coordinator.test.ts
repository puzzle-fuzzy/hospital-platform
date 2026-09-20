import { expect, test } from "bun:test";
import type {
	PaymentReconciliationResult,
	PaymentSyncRepository,
	PaymentSyncTask,
} from "./payment-sync";
import { PaymentSyncCoordinator } from "./payment-sync-coordinator";

const now = new Date("2026-09-21T00:00:00.000Z");

function createRepository(): PaymentSyncRepository {
	const tasks = new Map<string, PaymentSyncTask>();
	const results = new Map<string, PaymentReconciliationResult>();
	return {
		async findTaskById(taskId) {
			return tasks.get(taskId);
		},
		async findTaskByKey(aggregateId, businessKey, source, kind) {
			return [...tasks.values()].find(
				(task) =>
					task.aggregateId === aggregateId &&
					task.businessKey === businessKey &&
					task.source === source &&
					task.kind === kind,
			);
		},
		async enqueueTask(task) {
			tasks.set(task.taskId, task);
			return task;
		},
		async claimDueTasks(claimNow, limit, leaseMs) {
			const claimed: PaymentSyncTask[] = [];
			for (const task of tasks.values()) {
				if (
					claimed.length >= limit ||
					(task.status !== "pending" && task.status !== "in_progress") ||
					Date.parse(task.nextRunAt) > claimNow.getTime()
				) {
					continue;
				}
				const next: PaymentSyncTask = {
					...task,
					status: "in_progress",
					claimedUntil: new Date(claimNow.getTime() + leaseMs).toISOString(),
					version: task.version + 1,
					updatedAt: claimNow.toISOString(),
				};
				tasks.set(task.taskId, next);
				claimed.push(next);
			}
			return claimed;
		},
		async listTasksForAdmin() {
			return [...tasks.values()];
		},
		async updateTask(task, expectedVersion) {
			const current = tasks.get(task.taskId);
			if (!current || current.version !== expectedVersion) {
				throw new Error("task version conflict");
			}
			tasks.set(task.taskId, task);
			return task;
		},
		async appendReconciliation(result) {
			const key = `${result.aggregateId}:${result.source}:${result.observationKey}`;
			const existing = results.get(key);
			if (existing) return existing;
			results.set(key, result);
			return result;
		},
		async listReconciliations(aggregateId) {
			return [...results.values()].filter(
				(result) => result.aggregateId === aggregateId,
			);
		},
	};
}

test("payment sync coordinator is idempotent and resolves a matching observation", async () => {
	const repository = createRepository();
	const coordinator = new PaymentSyncCoordinator({
		repository,
		now: () => now,
		createId: () => "001",
	});
	const first = await coordinator.enqueue({
		aggregateId: "payagg-001",
		businessKey: "payment_order:order-001",
		source: "wechat_pay",
		kind: "reconcile",
	});
	const replay = await coordinator.enqueue({
		aggregateId: "payagg-001",
		businessKey: "payment_order:order-001",
		source: "wechat_pay",
		kind: "reconcile",
	});
	expect(replay).toEqual(first);
	const [claimed] = await coordinator.claimDue(now, 1, 60_000);
	expect(claimed?.status).toBe("in_progress");
	if (!claimed) throw new Error("expected a claimed task");

	const result = await coordinator.recordObservation({
		task: claimed,
		expectedAmountFen: 300,
		expectedStatus: "paid",
		observation: {
			observationKey: "wechat-query-001",
			observed: true,
			observedAmountFen: 300,
			observedStatus: "paid",
			evidenceDigest: "evidence-001",
			observedAt: now.toISOString(),
		},
	});
	expect(result.outcome).toBe("matched");
	expect(result.resolution).toBe("resolved");
	const stored = await repository.findTaskById(first.taskId);
	expect(stored?.status).toBe("succeeded");
});

test("payment sync mismatches and exhausted failures remain manual review", async () => {
	const repository = createRepository();
	const coordinator = new PaymentSyncCoordinator({
		repository,
		now: () => now,
		createId: (() => {
			let value = 0;
			return () => String(++value).padStart(3, "0");
		})(),
	});
	const task = await coordinator.enqueue({
		aggregateId: "payagg-002",
		businessKey: "medical_insurance:medical-002",
		source: "medical_insurance",
		kind: "reconcile",
		maxAttempts: 1,
	});
	const [claimed] = await coordinator.claimDue(now, 1, 60_000);
	if (!claimed) throw new Error("expected a claimed task");
	const result = await coordinator.recordObservation({
		task: claimed,
		expectedAmountFen: 500,
		observation: {
			observationKey: "medical-query-002",
			observed: true,
			observedAmountFen: 400,
			evidenceDigest: "evidence-002",
			observedAt: now.toISOString(),
		},
	});
	expect(result.outcome).toBe("amount_mismatch");
	expect((await repository.findTaskById(task.taskId))?.status).toBe(
		"manual_review",
	);

	const failureTask = await coordinator.enqueue({
		aggregateId: "payagg-003",
		businessKey: "payment_order:order-003",
		source: "his",
		kind: "pull",
		maxAttempts: 1,
	});
	const [failureClaim] = await coordinator.claimDue(now, 1, 60_000);
	if (!failureClaim) throw new Error("expected a failure task");
	await coordinator.markFailure({
		task: failureClaim,
		reasonCode: "contract-not-confirmed",
	});
	expect((await repository.findTaskById(failureTask.taskId))?.status).toBe(
		"manual_review",
	);
});
