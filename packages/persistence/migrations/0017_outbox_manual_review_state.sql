-- outbox 自动重试达到上限后必须停在可审计的人工接管状态。
-- 迁移先把已有已处理事件标为 processed，避免历史事实被默认值覆盖。
ALTER TABLE hp_outbox_events
	ADD COLUMN status VARCHAR(16) NOT NULL DEFAULT 'pending' AFTER attempts,
	ADD COLUMN manual_review_at DATETIME(3) NULL AFTER last_error,
	ADD KEY ix_hp_outbox_status_available (status, available_at, claimed_until);

UPDATE hp_outbox_events
	SET status = 'processed'
	WHERE processed_at IS NOT NULL;

-- 查单达到上限后同样必须有明确终态和人工接管时间，不能依赖内存状态。
ALTER TABLE hp_payment_prepay_attempts
	ADD COLUMN manual_review_at DATETIME(3) NULL AFTER last_error_code;
