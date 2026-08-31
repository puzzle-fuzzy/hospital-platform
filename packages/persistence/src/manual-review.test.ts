import { expect, test } from "bun:test";
import type { Pool } from "mysql2/promise";
import { createMySqlRepositories } from "./mysql-repositories";

function createOperationalFakePool(): {
	pool: Pool;
	queries: Array<{ sql: string; values: readonly unknown[] }>;
} {
	const queries: Array<{ sql: string; values: readonly unknown[] }> = [];
	const pool = {
		async execute(sql: string, values: readonly unknown[] = []) {
			queries.push({ sql, values });
			if (sql.includes("FROM hp_outbox_events")) {
				return [
					[
						{
							event_id: "event-001",
							event_name: "payment-order.created",
							aggregate_id: "order-001",
							attempts: "12",
							occurred_at: "2026-08-31 00:00:00.000",
							available_at: "2026-08-31 00:00:00.000",
							manual_review_at: "2026-08-31 00:10:00.000",
							last_error: "handler-failed",
						},
					],
					[],
				];
			}
			if (sql.includes("FROM hp_payment_prepay_attempts")) {
				return [
					[
						{
							attempt_id: "attempt-001",
							order_id: "order-001",
							provider: "wechat-pay",
							status: "manual_review",
							version: "13",
							query_attempts: "12",
							manual_review_at: "2026-08-31 00:10:00.000",
							last_error_code: "provider-query-failed",
							created_at: "2026-08-31 00:00:00.000",
							updated_at: "2026-08-31 00:10:00.000",
						},
					],
					[],
				];
			}
			return [{ affectedRows: 1 }, []];
		},
	} as unknown as Pool;
	return { pool, queries };
}

test("人工复核列表只返回低敏摘要，不返回 outbox payload", async () => {
	const { pool, queries } = createOperationalFakePool();
	const snapshot = await createMySqlRepositories(pool).operations.list(200);

	expect(snapshot.outbox).toEqual([
		{
			kind: "outbox",
			eventId: "event-001",
			eventName: "payment-order.created",
			aggregateId: "order-001",
			attempts: 12,
			occurredAt: "2026-08-31 00:00:00.000",
			availableAt: "2026-08-31 00:00:00.000",
			manualReviewAt: "2026-08-31 00:10:00.000",
			reasonCode: "handler-failed",
		},
	]);
	expect(snapshot.paymentQueries[0]).toMatchObject({
		kind: "wechat-payment-query",
		attemptId: "attempt-001",
		orderId: "order-001",
		queryAttempts: 12,
		lastErrorCode: "provider-query-failed",
	});
	expect(snapshot.outbox[0]).not.toHaveProperty("payload");
	expect(queries.every(({ sql }) => !sql.includes("payload"))).toBe(true);
});

test("人工复核重放使用状态条件并且不重置尝试次数", async () => {
	const { pool, queries } = createOperationalFakePool();
	const changed = await createMySqlRepositories(pool).operations.requeue({
		kind: "outbox",
		id: "event-001",
		now: new Date("2026-08-31T01:00:00.000Z"),
		reasonCode: "operator-confirmed",
	});

	expect(changed).toBe(true);
	const query = queries[0];
	expect(query.sql).toContain("status = 'manual_review'");
	expect(query.sql).toContain("processed_at IS NULL");
	expect(query.sql).not.toContain("attempts = 0");
	expect(query.values).toContain("manual-replay:operator-confirmed");
});

test("微信查单人工复核重放只清理当前尝试的调度状态", async () => {
	const { pool, queries } = createOperationalFakePool();
	const changed = await createMySqlRepositories(pool).operations.requeue({
		kind: "wechat-payment-query",
		id: "attempt-001",
		now: new Date("2026-08-31T01:00:00.000Z"),
		reasonCode: "provider-evidence-confirmed",
	});

	expect(changed).toBe(true);
	const query = queries[0];
	expect(query.sql).toContain("provider = 'wechat-pay'");
	expect(query.sql).toContain("status = 'manual_review'");
	expect(query.sql).toContain("version = version + 1");
	expect(query.values).toContain("manual-replay:provider-evidence-confirmed");
});
