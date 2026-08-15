-- 预支付查单调度必须可在 worker 重启后恢复。
-- query_attempts/next_query_at 不代表支付成功，只表示 provider 查询计划事实。
ALTER TABLE hp_payment_prepay_attempts
	ADD COLUMN query_attempts INT UNSIGNED NOT NULL DEFAULT 0 AFTER version,
	ADD COLUMN last_queried_at DATETIME(3) NULL AFTER query_attempts,
	ADD COLUMN next_query_at DATETIME(3) NULL AFTER last_queried_at,
	ADD KEY ix_hp_prepay_query_due (status, next_query_at);
