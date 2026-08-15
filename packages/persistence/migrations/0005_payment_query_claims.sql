-- 查单任务的数据库 claim lease；未被处理的记录在 lease 过期后可被其他 worker 接管。
ALTER TABLE hp_payment_prepay_attempts
	ADD COLUMN query_claimed_until DATETIME(3) NULL AFTER next_query_at,
	ADD KEY ix_hp_prepay_query_claim (
		status,
		next_query_at,
		query_claimed_until
	);
