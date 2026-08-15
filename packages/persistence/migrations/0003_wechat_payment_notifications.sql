-- 微信支付通知的白名单事实；原始 resource 不落库。
-- notification_id 和 provider_transaction_id 双重去重，且记录与入站 outbox
-- 在同一事务提交，保证 provider 重试或进程崩溃后仍可恢复。
CREATE TABLE IF NOT EXISTS hp_wechat_payment_notifications (
	notification_id VARCHAR(128) NOT NULL,
	event_type VARCHAR(64) NOT NULL,
	order_id VARCHAR(64) NOT NULL,
	trade_state VARCHAR(16) NOT NULL,
	total_fen BIGINT UNSIGNED NOT NULL,
	provider_transaction_id VARCHAR(128) NOT NULL,
	received_at DATETIME(3) NOT NULL,
	created_at DATETIME(3) NOT NULL,
	PRIMARY KEY (notification_id),
	UNIQUE KEY uq_hp_wechat_notification_transaction (provider_transaction_id),
	KEY ix_hp_wechat_notification_order (order_id, received_at),
	CONSTRAINT fk_hp_wechat_notification_order FOREIGN KEY (order_id)
		REFERENCES hp_payment_orders (order_id)
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_unicode_ci;
