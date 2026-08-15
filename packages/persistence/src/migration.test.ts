import { expect, test } from "bun:test";

test("core migration contains the transaction-critical constraints", async () => {
	const sql = await Bun.file(
		new URL("../migrations/0001_core.sql", import.meta.url),
	).text();
	const prepaySql = await Bun.file(
		new URL("../migrations/0002_payment_prepay_attempts.sql", import.meta.url),
	).text();
	const notificationSql = await Bun.file(
		new URL(
			"../migrations/0003_wechat_payment_notifications.sql",
			import.meta.url,
		),
	).text();
	const queryScheduleSql = await Bun.file(
		new URL("../migrations/0004_payment_query_schedule.sql", import.meta.url),
	).text();
	const queryClaimSql = await Bun.file(
		new URL("../migrations/0005_payment_query_claims.sql", import.meta.url),
	).text();

	expect(sql).toContain("CREATE TABLE IF NOT EXISTS hp_payment_orders");
	expect(prepaySql).toContain(
		"CREATE TABLE IF NOT EXISTS hp_payment_prepay_attempts",
	);
	expect(prepaySql).toContain("uq_hp_prepay_owner_order_idempotency");
	expect(sql).toContain("uq_hp_orders_owner_idempotency");
	expect(sql).toContain("CREATE TABLE IF NOT EXISTS hp_outbox_events");
	expect(sql).toContain("claimed_until DATETIME(3) NULL");
	expect(notificationSql).toContain(
		"CREATE TABLE IF NOT EXISTS hp_wechat_payment_notifications",
	);
	expect(notificationSql).toContain("uq_hp_wechat_notification_transaction");
	expect(notificationSql).toContain("fk_hp_wechat_notification_order");
	expect(queryScheduleSql).toContain("ADD COLUMN query_attempts");
	expect(queryScheduleSql).toContain("ADD COLUMN next_query_at");
	expect(queryScheduleSql).toContain("ix_hp_prepay_query_due");
	expect(queryClaimSql).toContain("ADD COLUMN query_claimed_until");
	expect(queryClaimSql).toContain("ix_hp_prepay_query_claim");
});
