import { expect, test } from "bun:test";
import type { PaymentSyncTask } from "@hospital/domain";
import {
	createInMemoryPaymentOperatorAuditRepository,
	createInMemoryPaymentSyncRepository,
} from "@hospital/persistence";
import {
	PaymentSyncAdminService,
	PaymentSyncAdminTaskConflictError,
} from "./payment-sync-service";

const baseTask: PaymentSyncTask = {
	taskId: "paysync-admin-001",
	aggregateId: "payagg-admin-001",
	businessKey: "payment_order:admin-001",
	source: "his",
	kind: "reconcile",
	status: "failed",
	attempts: 3,
	maxAttempts: 3,
	nextRunAt: "2026-09-20T00:00:00.000Z",
	claimedUntil: null,
	lastErrorCode: "timeout",
	resultDigest: null,
	version: 1,
	createdAt: "2026-09-20T00:00:00.000Z",
	updatedAt: "2026-09-20T00:00:00.000Z",
};

test("Admin can retry a failed sync task without changing payment terminal state", async () => {
	const repository = createInMemoryPaymentSyncRepository({ tasks: [baseTask] });
	const audits = createInMemoryPaymentOperatorAuditRepository();
	const service = new PaymentSyncAdminService({
		repository,
		operatorAudits: audits,
		now: () => new Date("2026-09-21T00:00:00.000Z"),
	});

	const retried = await service.retry("paysync-admin-001", {
		requestId: "admin-request-001",
	});

	expect(retried).toMatchObject({
		status: "pending",
		attempts: 0,
		claimedUntil: null,
		lastErrorCode: null,
		version: 2,
	});
	expect(await repository.findTaskById("paysync-admin-001")).toEqual(retried);
	expect(await audits.listByAggregate("payagg-admin-001")).toHaveLength(1);
	expect((await audits.listByAggregate("payagg-admin-001"))[0]).toMatchObject({
		action: "sync_retry",
		outcome: "succeeded",
		requestId: "admin-request-001",
	});
});

test("Admin can move a pending task to manual review and cannot take an active lease", async () => {
	const pending: PaymentSyncTask = {
		...baseTask,
		taskId: "paysync-admin-002",
		status: "pending",
		attempts: 0,
		lastErrorCode: null,
	};
	const active: PaymentSyncTask = {
		...baseTask,
		taskId: "paysync-admin-003",
		status: "in_progress",
		claimedUntil: "2026-09-21T00:10:00.000Z",
	};
	const repository = createInMemoryPaymentSyncRepository({
		tasks: [pending, active],
	});
	const audits = createInMemoryPaymentOperatorAuditRepository();
	const service = new PaymentSyncAdminService({
		repository,
		operatorAudits: audits,
	});

	const reviewed = await service.markManualReview(
		"paysync-admin-002",
		"HIS 金额待核对",
	);
	expect(reviewed).toMatchObject({
		status: "manual_review",
		lastErrorCode: "HIS 金额待核对",
		version: 2,
	});

	await expect(
		service.markManualReview("paysync-admin-003", "仍在执行"),
	).rejects.toBeInstanceOf(PaymentSyncAdminTaskConflictError);
});
