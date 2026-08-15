-- 预支付尝试独立于订单状态，保存服务重启后恢复所需的最小 provider 证据。
-- prepay_id 只保存摘要，pay params 由 repository 使用部署密钥加密后写入 ciphertext。
CREATE TABLE IF NOT EXISTS hp_payment_prepay_attempts (
	attempt_id VARCHAR(64) NOT NULL,
	owner_user_id VARCHAR(64) NOT NULL,
	order_id VARCHAR(64) NOT NULL,
	provider VARCHAR(32) NOT NULL,
	idempotency_key VARCHAR(128) NOT NULL,
	status VARCHAR(16) NOT NULL,
	version INT UNSIGNED NOT NULL,
	prepay_id_hash CHAR(64) NULL,
	pay_params_ciphertext TEXT NULL,
	provider_request_id VARCHAR(256) NULL,
	last_error_code VARCHAR(128) NULL,
	created_at DATETIME(3) NOT NULL,
	updated_at DATETIME(3) NOT NULL,
	PRIMARY KEY (attempt_id),
	UNIQUE KEY uq_hp_prepay_owner_order_idempotency (owner_user_id, order_id, idempotency_key),
	KEY ix_hp_prepay_order_status (order_id, status),
	CONSTRAINT fk_hp_prepay_owner FOREIGN KEY (owner_user_id)
		REFERENCES hp_identity_users (user_id),
	CONSTRAINT fk_hp_prepay_order FOREIGN KEY (order_id)
		REFERENCES hp_payment_orders (order_id)
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_unicode_ci;
