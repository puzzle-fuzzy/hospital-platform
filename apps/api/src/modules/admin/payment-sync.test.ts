import { expect, test } from "bun:test";
import type { PaymentSyncTask } from "@hospital/domain";
import { Elysia } from "elysia";
import { errorHandlerPlugin } from "../../plugins/error-handler";
import { adminPaymentSyncModule } from "./payment-sync";

const task: PaymentSyncTask = {
	taskId: "paysync-route-001",
	aggregateId: "payagg-route-001",
	businessKey: "payment_order:route-001",
	source: "wechat_pay",
	kind: "reconcile",
	status: "manual_review",
	attempts: 3,
	maxAttempts: 3,
	nextRunAt: "2026-09-21T00:00:00.000Z",
	claimedUntil: null,
	lastErrorCode: "status-mismatch",
	resultDigest: null,
	version: 4,
	createdAt: "2026-09-20T00:00:00.000Z",
	updatedAt: "2026-09-21T00:00:00.000Z",
};

test("Admin sync task routes enforce the refund admin token and expose safe actions", async () => {
	let retryTaskId = "";
	let manualReview: { taskId: string; reason: string } | undefined;
	const app = new Elysia().use(errorHandlerPlugin()).use(
		adminPaymentSyncModule(
			{
				async list() {
					return [task];
				},
				async retry(taskId) {
					retryTaskId = taskId;
					return { ...task, taskId, status: "pending" };
				},
				async markManualReview(taskId, reason) {
					manualReview = { taskId, reason };
					return { ...task, taskId, lastErrorCode: reason };
				},
			},
			"admin-refund-token-001",
		),
	);

	const listed = await app.handle(
		new Request(
			"http://localhost/admin/payment-sync-tasks?status=manual_review",
			{
				headers: { "x-admin-refund-token": "admin-refund-token-001" },
			},
		),
	);
	expect(listed.status).toBe(200);
	expect(await listed.json()).toEqual({ success: true, data: [task] });

	const retried = await app.handle(
		new Request(
			"http://localhost/admin/payment-sync-tasks/paysync-route-001/retry",
			{
				method: "POST",
				headers: { "x-admin-refund-token": "admin-refund-token-001" },
			},
		),
	);
	expect(retried.status).toBe(200);
	expect(retryTaskId).toBe("paysync-route-001");

	const reviewed = await app.handle(
		new Request(
			"http://localhost/admin/payment-sync-tasks/paysync-route-001/manual-review",
			{
				method: "POST",
				headers: {
					"content-type": "application/json",
					"x-admin-refund-token": "admin-refund-token-001",
				},
				body: JSON.stringify({ reason: "核对微信查单状态" }),
			},
		),
	);
	expect(reviewed.status).toBe(200);
	expect(manualReview).toEqual({
		taskId: "paysync-route-001",
		reason: "核对微信查单状态",
	});

	const unauthorized = await app.handle(
		new Request("http://localhost/admin/payment-sync-tasks", {
			headers: { "x-admin-refund-token": "wrong-token" },
		}),
	);
	expect(unauthorized.status).toBe(401);
});
